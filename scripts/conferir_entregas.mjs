#!/usr/bin/env node
/**
 * Pergunta ao fornecedor o que aconteceu às mensagens que ficaram em «Aceite» e
 * fecha-lhes o estado em `email_log`.
 *
 * A aplicação já confirma a entrega sozinha, alguns minutos depois de cada
 * envio (`confirmarEntrega`, em `src/lib/email.ts`). Esta ferramenta existe para
 * os dois buracos que essa sondagem não tapa, e que são reais:
 *
 *   1. **o contentor reiniciou a meio** — um deploy no Coolify apanha as
 *      verificações por fazer e leva-as com ele; a linha fica em `enviado`, que
 *      é verdade mas não é o desfecho;
 *   2. **o desfecho chegou tarde** — um servidor de destino pode aceitar e só
 *      devolver a mensagem horas depois, muito para lá da última tentativa.
 *
 * Uso, dentro do contentor:
 *
 *   node scripts/conferir_entregas.mjs
 *   node scripts/conferir_entregas.mjs --dias 30
 *   node scripts/conferir_entregas.mjs --simular   (não escreve nada)
 *
 * ou, em desenvolvimento:  pnpm email:conferir
 *
 * A lógica de leitura das duas APIs está aqui repetida e não importada de
 * `src/lib/email.ts` pela mesma razão do `testar_email.mjs`: a imagem de
 * produção não leva o código da aplicação, só o `.next/standalone`. Um script
 * que só corra em desenvolvimento não serve para nada — é em produção que as
 * linhas ficam por confirmar.
 */

import postgres from "postgres";

const TEMPO_LIMITE_MS = 15_000;

const argumentos = process.argv.slice(2);
const simular = argumentos.includes("--simular");
const dias = Number(argumentos[argumentos.indexOf("--dias") + 1]) || 7;

const chaves = {
  brevo: process.env.BREVO_API_KEY,
  resend: process.env.RESEND_API_KEY,
  twilio_sendgrid: process.env.TWILIO_SENDGRID_API_KEY,
};
const urlBd = process.env.DATABASE_URL;

if (!urlBd) {
  console.error("Falta a DATABASE_URL — sem base de dados não há linhas para conferir.");
  process.exit(1);
}

const sql = postgres(urlBd, { max: 1, prepare: false });

try {
  const linhas = await sql`
    select id, para, template, canal, mensagem_id, criado_em
      from email_log
     where estado = 'enviado'
       and canal is not null
       and mensagem_id is not null
       and criado_em > now() - ${`${dias} days`}::interval
     order by criado_em desc
     limit 500`;

  if (linhas.length === 0) {
    console.log(`Nenhuma mensagem por confirmar nos últimos ${dias} dias.`);
    process.exit(0);
  }

  console.log(`${linhas.length} mensagem(ns) por confirmar nos últimos ${dias} dias.\n`);

  const contagem = { entregue: 0, devolvido: 0, queixa: 0, pendente: 0, erro: 0 };

  for (const l of linhas) {
    const chave = chaves[l.canal];
    if (!chave) {
      console.error(`  ? ${l.para} — a chave do ${l.canal} não está neste ambiente.`);
      contagem.erro++;
      continue;
    }

    const r =
      l.canal === "resend"
        ? await verificarResend(l.mensagem_id, chave)
        : l.canal === "twilio_sendgrid"
          ? await verificarTwilio(l.mensagem_id, chave)
          : await verificarBrevo(l.mensagem_id, chave);

    if (!r.ok) {
      console.error(`  ✗ ${l.para} — ${r.erro}`);
      contagem.erro++;
      continue;
    }

    contagem[r.evento]++;

    if (r.evento === "pendente") {
      console.log(`  · ${l.para} — ainda sem desfecho (${r.motivo ?? "sem motivo"})`);
      continue;
    }

    const marca = r.evento === "entregue" ? "✓" : "✗";
    console.log(`  ${marca} ${l.para} — ${r.evento}${r.motivo ? `: ${r.motivo}` : ""}`);

    if (simular) continue;

    // O `erro` só é tocado quando há motivo: um `entregue` não pode apagar a
    // razão de uma tentativa anterior ter falhado.
    await sql`
      update email_log
         set estado = ${r.evento},
             verificado_em = now(),
             erro = coalesce(${r.motivo ? r.motivo.slice(0, 2000) : null}, erro)
       where id = ${l.id}`;
  }

  console.log(
    `\nEntregues ${contagem.entregue} · devolvidas ${contagem.devolvido} · ` +
      `spam ${contagem.queixa} · ainda pendentes ${contagem.pendente} · ` +
      `não consultadas ${contagem.erro}`,
  );
  if (simular) console.log("(--simular: nada foi escrito na base de dados.)");
} finally {
  await sql.end({ timeout: 5 });
}

/* ------------------------------------------------------------------------ */

async function verificarResend(mensagemId, chave) {
  try {
    const resposta = await fetch(`https://api.resend.com/emails/${encodeURIComponent(mensagemId)}`, {
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      headers: { Authorization: `Bearer ${chave}` },
    });
    if (!resposta.ok) {
      return { ok: false, erro: `Resend devolveu ${resposta.status}: ${await resposta.text()}` };
    }
    const corpo = await resposta.json();
    switch (corpo.last_event) {
      case "delivered":
        return { ok: true, evento: "entregue" };
      case "bounced":
        return {
          ok: true,
          evento: "devolvido",
          motivo:
            corpo.bounce?.message ||
            [corpo.bounce?.type, corpo.bounce?.subType].filter(Boolean).join(" / ") ||
            "devolvido pelo servidor de destino (sem motivo indicado)",
        };
      case "complained":
        return { ok: true, evento: "queixa", motivo: "o destinatário marcou a mensagem como spam" };
      default:
        return { ok: true, evento: "pendente", motivo: corpo.last_event || "sem last_event" };
    }
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * O Brevo devolve uma lista de eventos, e a ordem dela não é a de gravidade —
 * fica o mais grave dos que lá estiverem. O 404 é resposta normal: quer dizer
 * que ainda não há evento nenhum para aquele id.
 */
async function verificarBrevo(mensagemId, chave) {
  try {
    const url = `https://api.brevo.com/v3/smtp/statistics/events?messageId=${encodeURIComponent(mensagemId)}&limit=50`;
    const resposta = await fetch(url, {
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      headers: { "api-key": chave },
    });
    if (resposta.status === 404) {
      return { ok: true, evento: "pendente", motivo: "ainda sem eventos no Brevo" };
    }
    if (!resposta.ok) {
      return { ok: false, erro: `Brevo devolveu ${resposta.status}: ${await resposta.text()}` };
    }
    const { events = [] } = await resposta.json();
    const gravidade = { pendente: 0, entregue: 1, queixa: 2, devolvido: 3 };
    let melhor = "pendente";
    let motivo;
    for (const e of events) {
      const nome = String(e.event ?? "");
      const evento = eventoBrevo(nome);
      if (gravidade[evento] <= gravidade[melhor]) continue;
      melhor = evento;
      motivo = evento === "entregue" ? undefined : e.reason || nome;
    }
    return { ok: true, evento: melhor, motivo };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }
}

function eventoBrevo(nome) {
  const n = nome.toLowerCase();
  if (n.includes("bounce") || n === "blocked" || n === "invalid" || n === "error") {
    return "devolvido";
  }
  if (n === "spam" || n === "complaint") return "queixa";
  if (n === "delivered") return "entregue";
  return "pendente";
}

async function verificarTwilio(mensagemId, chave) {
  try {
    const resposta = await fetch(`https://api.sendgrid.com/v3/messages/${encodeURIComponent(mensagemId)}`, {
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      headers: { Authorization: `Bearer ${chave}` },
    });
    if (resposta.status === 404) {
      return { ok: true, evento: "pendente", motivo: "ainda sem eventos no SendGrid" };
    }
    if (!resposta.ok) {
      return { ok: false, erro: `Twilio SendGrid devolveu ${resposta.status}: ${await resposta.text()}` };
    }
    const corpo = await resposta.json();
    const eventos = corpo.events ?? [];
    if (eventos.length > 0) {
      const gravidade = { pendente: 0, entregue: 1, queixa: 2, devolvido: 3 };
      let melhor = "pendente";
      let motivo;
      for (const e of eventos) {
        const nome = String(e.event_name ?? "");
        const evento = eventoSendGrid(nome);
        if (gravidade[evento] <= gravidade[melhor]) continue;
        melhor = evento;
        motivo = evento === "entregue" ? undefined : e.reason || nome;
      }
      if (melhor !== "pendente" || !corpo.status) {
        return { ok: true, evento: melhor, motivo };
      }
    }
    const status = String(corpo.status ?? "").toLowerCase();
    const evento = eventoSendGrid(status);
    if (evento === "devolvido") {
      return { ok: true, evento: "devolvido", motivo: corpo.status || "devolvido" };
    }
    if (evento === "queixa") {
      return { ok: true, evento: "queixa", motivo: "o destinatário marcou a mensagem como spam" };
    }
    if (evento === "entregue") {
      return { ok: true, evento: "entregue" };
    }
    return { ok: true, evento: "pendente", motivo: corpo.status || "sem eventos no SendGrid" };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }
}

function eventoSendGrid(nome) {
  const n = nome.toLowerCase();
  if (n.includes("bounce") || n === "dropped" || n === "blocked" || n === "error" || n === "not_delivered") {
    return "devolvido";
  }
  if (n.includes("spam") || n === "complaint" || n === "spamreport") {
    return "queixa";
  }
  if (n === "delivered" || n === "open" || n === "click") {
    return "entregue";
  }
  return "pendente";
}
