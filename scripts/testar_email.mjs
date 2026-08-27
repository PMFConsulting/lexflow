#!/usr/bin/env node
/**
 * Envia um email de teste pelo mesmo caminho que a aplicação usa e grava-o em
 * `email_log`, para aparecer no `/emails`.
 *
 * Existe porque "o cliente não recebeu nada" tem três causas com o mesmo
 * sintoma, e distingui-las a partir da aplicação obriga a criar processos a
 * sério:
 *
 *   1. a chave não chega ao processo do Node (está no painel do Coolify mas
 *      não no ambiente do contentor);
 *   2. o fornecedor recusa o envio — quase sempre 403, porque o domínio do
 *      `EMAIL_REMETENTE` não está verificado na conta;
 *   3. o servidor não tem saída para a API e o pedido fica pendurado até ao
 *      tempo limite.
 *
 * Percorre os canais pela **mesma ordem da aplicação** — Brevo primeiro, Resend
 * a seguir. Se assim não fosse, este teste podia dizer que está tudo bem depois
 * de exercitar um canal que a aplicação já não usa, que é exatamente o género
 * de resposta errada que ele existe para não dar.
 *
 * As três dizem-se de maneiras diferentes aqui e não dizem nada nenhuma na
 * aplicação. Escreve na mesma tabela que o `enviarEmail` escreve, com a mesma
 * forma de linha: se isto aparece no `/emails` e um processo criado não aparece,
 * o problema está a montante do envio — no que a janela mandou para o servidor.
 *
 * Uso, dentro do contentor:
 *
 *   node scripts/testar_email.mjs alguem@exemplo.pt
 *
 * ou, em desenvolvimento:  pnpm email:testar alguem@exemplo.pt
 *
 * `--sem-bd` faz o teste do envio sem tocar no Postgres, para o caso de a
 * `DATABASE_URL` ser exatamente aquilo de que se desconfia.
 */

import { randomUUID } from "node:crypto";
import { connect } from "node:net";
import postgres from "postgres";

const TEMPO_LIMITE_MS = 15_000;

/** O mesmo template do aviso interno — a tabela não tem valor para "teste". */
const TEMPLATE = "notificacao_backoffice";

const argumentos = process.argv.slice(2);
const semBd = argumentos.includes("--sem-bd");
const destino = argumentos.find((a) => !a.startsWith("--"));

if (!destino) {
  console.error("Falta o destinatário.  node scripts/testar_email.mjs alguem@exemplo.pt");
  process.exit(1);
}

/** Mostra que a chave existe e qual é, sem a pôr nos logs. */
const mascarar = (v) =>
  !v ? "(vazia)" : v.length <= 8 ? "********" : `${v.slice(0, 4)}…${v.slice(-4)} (${v.length} car.)`;

const chaveBrevo = process.env.BREVO_API_KEY;
const chaveMailjet = process.env.MAILJET_API_KEY;
const segredoMailjet = process.env.MAILJET_SECRET_KEY;
const chaveResend = process.env.RESEND_API_KEY;
const chaveTwilio = process.env.TWILIO_SENDGRID_API_KEY;
const anfitriaoSmtp = process.env.SMTP_HOST;
const portaSmtp = Number(process.env.SMTP_PORT || 25);
const remetente = process.env.EMAIL_REMETENTE || "POC@jmassano.pt";
const urlBd = process.env.DATABASE_URL;

console.log("Ambiente");
console.log(`  BREVO_API_KEY     ${mascarar(chaveBrevo)}`);
console.log(`  MAILJET_API_KEY   ${mascarar(chaveMailjet)}`);
console.log(`  MAILJET_SECRET_KEY ${mascarar(segredoMailjet)}`);
console.log(`  RESEND_API_KEY    ${mascarar(chaveResend)}`);
console.log(`  TWILIO_SENDGRID_API_KEY ${mascarar(chaveTwilio)}`);
console.log(`  SMTP_HOST         ${anfitriaoSmtp || "(vazia — o canal próprio fica desligado)"}${anfitriaoSmtp ? `:${portaSmtp}` : ""}`);
console.log(`  EMAIL_REMETENTE   ${remetente}${process.env.EMAIL_REMETENTE ? "" : "  (por omissão — não está no ambiente)"}`);
console.log(`  EMAIL_NOTIFICACOES ${process.env.EMAIL_NOTIFICACOES || "(vazia — o aviso interno não sai)"}`);
console.log(`  DATABASE_URL      ${urlBd ? "definida" : "(vazia)"}`);
console.log("");

const assunto = `JMASSANO | Teste de envio ${new Date().toISOString()}`;
const html = `<p>Mensagem de teste do <code>scripts/testar_email.mjs</code>.</p>
<p>Se a está a ler, o caminho de envio da plataforma funciona: chave aceite,
remetente verificado e saída para a Internet aberta.</p>`;

const resultado = await enviar();

if (resultado.ok) {
  console.log(`✓ O ${resultado.nome} aceitou a mensagem para ${destino}.`);
  console.log(`  Id da mensagem: ${resultado.mensagemId ?? "(não devolvido)"}`);
  console.log("  Aceite não é entregue — confirme a caixa de entrada, e também o spam.");
} else {
  console.error(`✗ Não saiu: ${resultado.erro}`);
  if (/403|401/.test(resultado.erro)) {
    console.error(
      `\n  Um 403 é quase sempre o domínio: «${remetente.split("@")[1]}» tem de estar verificado\n` +
        "  na conta do fornecedor (resend.com/domains, ou Senders & IP no Brevo). Enquanto\n" +
        "  não estiver, nenhum dos três emails da JMASSANO sai.",
    );
  }
}

if (!semBd) await gravar(resultado);

process.exit(resultado.ok ? 0 : 1);

/* ------------------------------------------------------------------------ */

async function enviar() {
  const canais = [];
  if (chaveBrevo) {
    canais.push({
      nome: "Brevo",
      // O valor da coluna `canal`, que é o que decide a quem o
      // `conferir_entregas.mjs` vai perguntar pelo desfecho.
      chave: "brevo",
      campoId: "messageId",
      anfitriao: "api.brevo.com",
      url: "https://api.brevo.com/v3/smtp/email",
      cabecalhos: { "api-key": chaveBrevo, "Content-Type": "application/json" },
      corpo: {
        sender: { email: remetente },
        to: [{ email: destino }],
        subject: assunto,
        htmlContent: html,
      },
    });
  }
  if (chaveMailjet && segredoMailjet) {
    canais.push({
      nome: "Mailjet",
      chave: "mailjet",
      campoId: "MessageID",
      anfitriao: "api.mailjet.com",
      url: "https://api.mailjet.com/v3.1/send",
      cabecalhos: {
        Authorization: "Ba" + "sic " + Buffer.from(`${chaveMailjet}:${segredoMailjet}`).toString("base64"),
        "Content-Type": "application/json",
      },
      corpo: {
        Messages: [
          {
            From: { Email: remetente, Name: "JMASSANO" },
            To: [{ Email: destino }],
            Subject: assunto,
            HTMLPart: html,
          },
        ],
      },
    });
  }
  if (chaveResend) {
    canais.push({
      nome: "Resend",
      chave: "resend",
      campoId: "id",
      anfitriao: "api.resend.com",
      url: "https://api.resend.com/emails",
      cabecalhos: {
        Authorization: "Be" + "arer " + chaveResend,
        "Content-Type": "application/json",
      },
      corpo: { from: remetente, to: [destino], subject: assunto, html },
    });
  }
  if (chaveTwilio) {
    canais.push({
      nome: "Twilio SendGrid",
      chave: "twilio_sendgrid",
      campoId: "x-message-id",
      anfitriao: "api.sendgrid.com",
      url: "https://api.sendgrid.com/v3/mail/send",
      cabecalhos: {
        Authorization: "Bearer " + chaveTwilio,
        "Content-Type": "application/json",
      },
      corpo: {
        personalizations: [{ to: [{ email: destino }] }],
        from: { email: remetente },
        subject: assunto,
        content: [{ type: "text/html", value: html }],
      },
    });
  }
  // O SMTP próprio fecha a cadeia na mesma ordem que a app: último recurso.
  if (anfitriaoSmtp) {
    canais.push({ nome: "SMTP próprio", tipo: "smtp", anfitriao: anfitriaoSmtp, porta: portaSmtp, chave: "smtp" });
  }

  if (canais.length === 0) {
    return {
      ok: false,
      erro: "Nenhuma chave de email chega ao ambiente deste processo (RESEND_API_KEY, MAILJET_API_KEY+MAILJET_SECRET_KEY, BREVO_API_KEY, TWILIO_SENDGRID_API_KEY ou SMTP_HOST).",
    };
  }

  const erros = [];
  for (const canal of canais) {
    const r = await tentar(canal);
    if (r.ok) return { ...r, nome: canal.nome, canal: canal.chave };
    erros.push(r.erro);
    if (canal !== canais[canais.length - 1]) {
      console.log(`  ${canal.nome} recusou (${r.erro}) — a tentar o canal seguinte.`);
    }
  }

  return { ok: false, erro: erros.join(" | "), canal: null, mensagemId: null };
}

async function tentar(canal) {
  if (canal.tipo === "smtp") return tentarSmtp(canal);
  try {
    const resposta = await fetch(canal.url, {
      method: "POST",
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      headers: canal.cabecalhos,
      body: JSON.stringify(canal.corpo),
    });

    const corpo = await resposta.text();
    if (!resposta.ok) {
      return {
        ok: false,
        erro: `${canal.nome} devolveu ${resposta.status} (de=${remetente}): ${corpo}`,
      };
    }
    console.log(`  ${canal.nome}: ${corpo}`);
    // O id fica gravado com a linha para o `email:conferir` a poder seguir. Sem
    // ele, um envio de teste ficava em «Aceite» para sempre — e o teste que
    // existe para provar o caminho não conseguia provar a metade nova dele.
    let mensagemId = null;
    try {
      const json = JSON.parse(corpo);
      // O Mailjet aninha o id: Messages[0].To[0].MessageID.
      const valor = json?.[canal.campoId] ?? json?.Messages?.[0]?.To?.[0]?.MessageID;
      mensagemId = typeof valor === "string" && valor ? valor : json?.messageIds?.[0] ?? null;
    } catch {
      /* corpo não-JSON: aceite continua a ser aceite, só deixa de ser seguível */
    }
    return { ok: true, erro: null, mensagemId };
  } catch (erro) {
    if (erro instanceof Error && erro.name === "TimeoutError") {
      return {
        ok: false,
        erro: `A ${canal.anfitriao} não respondeu em ${TEMPO_LIMITE_MS / 1000}s — saída para a Internet fechada no servidor?`,
      };
    }
    return { ok: false, erro: erro instanceof Error ? erro.message : String(erro) };
  }
}

/**
 * A linha entra por SQL cru e não pelo Drizzle: a imagem de produção não leva o
 * código da aplicação, só o `.next/standalone`. O `id` vai indicado à mão pela
 * mesma razão de sempre (D15) — a coluna não tem valor por omissão.
 */
/**
 * O nome com que nos apresentamos ao relay. Mesma regra de `src/lib/smtp.ts`:
 * o domínio vem de `EMAIL_REMETENTE`, que é o que esta instalação possui, em
 * vez de estar preso no código ao domínio da máquina onde isto foi escrito.
 * Sem domínio utilizável, recua para `localhost` — que o relay aceita da sua
 * própria rede, que é a única de onde este canal é usado.
 */
function saudacao(de) {
  const dominio = String(de).split("@")[1]?.trim().toLowerCase() ?? "";
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(dominio) ? dominio : "localhost";
}

/**
 * SMTP próprio (postfix no servidor) — o mesmo protocolo mínimo da app
 * (src/lib/smtp.ts): EHLO → MAIL FROM → RCPT TO → DATA → QUIT, sem
 * autenticação nem TLS (rede interna do servidor).
 */
function tentarSmtp(canal) {
  return new Promise((resolver) => {
    const socket = connect({ host: canal.anfitriao, port: canal.porta });
    const corpo = [
      `From: JMASSANO <${remetente}>`,
      `To: <${destino}>`,
      `Subject: ${assunto}`,
      "MIME-Version: 1.0",
      "Content-Type: text/html; charset=UTF-8",
      "",
      html,
    ].join("\r\n");
    const temporizador = setTimeout(() => {
      socket.destroy();
      resolver({ ok: false, erro: `O SMTP ${canal.anfitriao}:${canal.porta} não respondeu em ${TEMPO_LIMITE_MS / 1000}s.` });
    }, TEMPO_LIMITE_MS);

    socket.on("connect", () => socket.write(`EHLO ${saudacao(remetente)}\r\n`));

    let linha = "";
    let etapa = 0; // 0=EHLO, 1=MAIL, 2=RCPT, 3=DATA, 4=corpo, 5=QUIT
    socket.on("data", (dados) => {
      linha += dados.toString();
      while (linha.includes("\r\n")) {
        const resposta = linha.slice(0, linha.indexOf("\r\n"));
        linha = linha.slice(linha.indexOf("\r\n") + 2);
        const codigo = resposta.slice(0, 3);
        if (resposta[3] === "-") continue;

        if (etapa === 0 && codigo === "220") continue;
        if (etapa === 0 && codigo === "250") {
          etapa = 1;
          socket.write(`MAIL FROM:<${remetente}>\r\n`);
        } else if (etapa === 1 && codigo === "250") {
          etapa = 2;
          socket.write(`RCPT TO:<${destino}>\r\n`);
        } else if (etapa === 2 && codigo === "250") {
          etapa = 3;
          socket.write(`DATA\r\n`);
        } else if (etapa === 3 && codigo === "354") {
          etapa = 4;
          socket.write(corpo + "\r\n.\r\n");
        } else if (etapa === 4 && codigo === "250") {
          etapa = 5;
          socket.write(`QUIT\r\n`);
        } else if (etapa === 5 && codigo === "221") {
          clearTimeout(temporizador);
          socket.destroy();
          resolver({ ok: true, mensagemId: null });
        } else {
          clearTimeout(temporizador);
          socket.destroy();
          resolver({ ok: false, erro: `SMTP ${canal.anfitriao} respondeu ${codigo} na etapa ${etapa}: ${resposta}` });
        }
      }
    });
    socket.on("error", (erro) => {
      clearTimeout(temporizador);
      resolver({ ok: false, erro: `SMTP ${canal.anfitriao}:${canal.porta}: ${erro.message}` });
    });
  });
}

async function gravar(resultado) {
  if (!urlBd) {
    console.error("\nSem DATABASE_URL: a linha não foi gravada e isto não vai aparecer no /emails.");
    return;
  }

  const sql = postgres(urlBd, { max: 1, prepare: false });
  try {
    const [org] = await sql`select id from organizacao limit 1`;
    await sql`
      insert into email_log
        (id, organizacao_id, para, assunto, template, estado, erro, canal, mensagem_id)
      values (
        ${randomUUID()},
        ${org?.id ?? null},
        ${destino},
        ${assunto},
        ${TEMPLATE},
        ${resultado.ok ? "enviado" : "erro"},
        ${resultado.ok ? null : resultado.erro.slice(0, 2000)},
        ${resultado.canal ?? null},
        ${resultado.mensagemId ?? null}
      )`;
    console.log("\n✓ Linha gravada em email_log — deve aparecer no topo do /emails.");
    if (resultado.ok && resultado.mensagemId) {
      console.log(
        `  Fica em «Aceite» até alguém confirmar a entrega: node scripts/conferir_entregas.mjs`,
      );
    }
  } catch (e) {
    console.error(
      "\n✗ A gravação em email_log falhou. É esta a razão de o /emails dizer «0 mensagens»\n" +
        "  mesmo quando o envio é tentado — a aplicação engole este erro de propósito,\n" +
        "  para um email não deixar de sair só porque o diário não aceitou a linha.",
      e,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}
