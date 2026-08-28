#!/usr/bin/env node
/**
 * Script diário de agregação e envio do "Resumo Terlica" ao Dono da plataforma (Frente P).
 *
 * Corre diariamente (ex: às 09:00 via cron no Coolify / servidor):
 * 1. Lê todas as notificações pendentes da tabela `notificacoes_pendentes` (novas sociedades, novos utilizadores).
 * 2. Consulta novos processos submetidos nas últimas 24 horas.
 * 3. Se houver eventos (ou com flag --forcar), compõe e envia 1 email único agregado para EMAIL_NOTIFICACOES.
 * 4. Marca as linhas processadas com `processado_em = now()`.
 * 5. Regista a linha no diário de envio (`email_log`).
 *
 * Zero dependências externas além do `postgres` (padrão de scripts/testar_email.mjs).
 *
 * Uso:
 *   node scripts/resumo_diario.mjs
 *   node scripts/resumo_diario.mjs --forcar   # Envia mesmo sem eventos pendentes
 *   node scripts/resumo_diario.mjs --dry-run  # Mostra o conteúdo sem enviar nem marcar
 */

import { randomUUID } from "node:crypto";
import { connect } from "node:net";
import postgres from "postgres";

const TEMPO_LIMITE_MS = 15_000;

const argumentos = process.argv.slice(2);
const forcar = argumentos.includes("--forcar");
const dryRun = argumentos.includes("--dry-run");

const chaveBrevo = process.env.BREVO_API_KEY;
const chaveMailjet = process.env.MAILJET_API_KEY;
const segredoMailjet = process.env.MAILJET_SECRET_KEY;
const chaveResend = process.env.RESEND_API_KEY;
const chaveTwilio = process.env.TWILIO_SENDGRID_API_KEY;
const anfitriaoSmtp = process.env.SMTP_HOST;
const portaSmtp = Number(process.env.SMTP_PORT || 25);
const remetente = process.env.EMAIL_REMETENTE || "POC@jmassano.pt";
const emailDono = process.env.EMAIL_NOTIFICACOES;
const urlBd = process.env.DATABASE_URL;
const urlBase = (process.env.BETTER_AUTH_URL ?? "https://poc.terlicalabs.com").replace(/\/+$/, "");

if (!urlBd) {
  console.error("[resumo_diario] DATABASE_URL não definida. Abortando.");
  process.exit(1);
}

if (!emailDono) {
  console.info("[resumo_diario] EMAIL_NOTIFICACOES não definida. Resumo diário omitido.");
  process.exit(0);
}

const sql = postgres(urlBd, { max: 1, prepare: false });

try {
  // 1. Ler notificações pendentes
  const pendentes = await sql`
    select id, tipo, organizacao_id, dados, criado_em
    from notificacoes_pendentes
    where processado_em is null
    order by criado_em asc
    limit 500
  `;

  // 2. Contar processos submetidos nas últimas 24h
  const [processos24h] = await sql`
    select count(*)::int as total
    from processo_onboarding
    where estado in ('aguardar_aprovacao', 'aprovado', 'rejeitado')
      and submetido_em >= now() - interval '24 hours'
  `;
  const totalProcessos = Number(processos24h?.total ?? 0);

  if (pendentes.length === 0 && totalProcessos === 0 && !forcar) {
    console.log("[resumo_diario] Nenhuma notificação pendente nem processos submetidos nas últimas 24h. Resumo omitido.");
    process.exit(0);
  }

  // 3. Organizar dados
  const sociedades = [];
  const utilizadores = [];

  for (const item of pendentes) {
    if (item.tipo === "sociedade_criada") {
      sociedades.push(item.dados);
    } else if (item.tipo === "novo_utilizador") {
      utilizadores.push(item.dados);
    }
  }

  const dataHoje = new Date();
  const dataFormatada = new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(dataHoje);

  const partesAssunto = [];
  if (sociedades.length > 0) {
    partesAssunto.push(`${sociedades.length} nova${sociedades.length > 1 ? "s" : ""} sociedade${sociedades.length > 1 ? "s" : ""}`);
  }
  if (utilizadores.length > 0) {
    partesAssunto.push(`${utilizadores.length} novo${utilizadores.length > 1 ? "s" : ""} utilizador${utilizadores.length > 1 ? "es" : ""}`);
  }

  const assunto =
    partesAssunto.length > 0
      ? `LexFlow | Resumo Diário: ${partesAssunto.join(", ")} (${dataFormatada})`
      : `LexFlow | Resumo Diário — ${dataFormatada}`;

  const html = construirHtmlResumo({
    dataHoje,
    sociedades,
    utilizadores,
    totalProcessos,
    urlAdmin: `${urlBase}/admin`,
  });

  if (dryRun) {
    console.log("=== DRY RUN: RESUMO DIÁRIO ===");
    console.log(`Para: ${emailDono}`);
    console.log(`Assunto: ${assunto}`);
    console.log(`Sociedades pendentes: ${sociedades.length}`);
    console.log(`Utilizadores pendentes: ${utilizadores.length}`);
    console.log(`Processos 24h: ${totalProcessos}`);
    console.log("===============================");
    process.exit(0);
  }

  // 4. Enviar email
  const resultadoEnvio = await enviar({
    para: emailDono,
    assunto,
    html,
  });

  if (!resultadoEnvio.ok) {
    console.error(`[resumo_diario] Falha ao enviar email do resumo: ${resultadoEnvio.erro}`);
    process.exit(1);
  }

  console.log(`✓ Resumo diário enviado com sucesso para ${emailDono} via ${resultadoEnvio.nome}.`);

  // 5. Marcar pendentes como processados
  if (pendentes.length > 0) {
    const ids = pendentes.map((p) => p.id);
    await sql`
      update notificacoes_pendentes
      set processado_em = now()
      where id = any(${ids})
    `;
    console.log(`✓ ${ids.length} notificação(ões) pendente(s) marcada(s) como processada(s).`);
  }

  // 6. Gravar em email_log
  try {
    await sql`
      insert into email_log
        (id, organizacao_id, para, assunto, template, estado, erro, canal, mensagem_id)
      values (
        ${randomUUID()},
        null,
        ${emailDono},
        ${assunto},
        'notificacao_backoffice',
        'enviado',
        null,
        ${resultadoEnvio.canal ?? null},
        ${resultadoEnvio.mensagemId ?? null}
      )
    `;
  } catch (e) {
    console.warn("[resumo_diario] Não foi possível registar linha no email_log:", e);
  }

} catch (erro) {
  console.error("[resumo_diario] Erro inesperado:", erro);
  process.exit(1);
} finally {
  await sql.end({ timeout: 5 });
}

/* ---------------------------------------------------------------- HTML builder */

function escapar(texto) {
  return String(texto ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function rotuloPapel(papel) {
  switch (papel) {
    case "super_admin":
      return "Admin Plataforma";
    case "society_admin":
      return "Admin Sociedade";
    case "gestor":
      return "Gestor";
    case "utilizador":
      return "Utilizador";
    default:
      return papel || "Utilizador";
  }
}

function construirHtmlResumo({ dataHoje, sociedades, utilizadores, totalProcessos, urlAdmin }) {
  const dataExtenso = new Intl.DateTimeFormat("pt-PT", { dateStyle: "long" }).format(dataHoje);
  const hrefAdmin = escapar(urlAdmin);

  const htmlSociedades =
    sociedades.length > 0
      ? `
      <div style="margin-bottom: 24px;">
        <h3 style="font-family:'Newsreader',serif;font-size:16px;font-weight:600;color:#18181b;margin:0 0 10px;">
          🏢 Novas Sociedades Integradas (${sociedades.length})
        </h3>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
               style="background:#ffffff;border:1px solid #e4e4e7;border-radius:6px;border-collapse:collapse;">
          <thead>
            <tr style="background:#f4f4f5;border-bottom:1px solid #e4e4e7;">
              <th style="padding:10px 12px;font-family:ui-monospace,monospace;font-size:11px;text-align:left;color:#71717a;text-transform:uppercase;">Sociedade / NIF</th>
              <th style="padding:10px 12px;font-family:ui-monospace,monospace;font-size:11px;text-align:left;color:#71717a;text-transform:uppercase;">Prefixo</th>
              <th style="padding:10px 12px;font-family:ui-monospace,monospace;font-size:11px;text-align:left;color:#71717a;text-transform:uppercase;">Admin Inicial</th>
            </tr>
          </thead>
          <tbody>
            ${sociedades
              .map(
                (s, idx) => `
              <tr style="${idx > 0 ? "border-top:1px solid #e4e4e7;" : ""}">
                <td style="padding:12px;font-family:'Newsreader',serif;font-size:13px;color:#18181b;">
                  <strong>${escapar(s.nome)}</strong><br/>
                  <span style="font-family:ui-monospace,monospace;font-size:12px;color:#71717a;">NIF: ${escapar(s.nif)}</span>
                </td>
                <td style="padding:12px;font-family:ui-monospace,monospace;font-size:13px;color:#18181b;">
                  ${escapar(s.prefixo)}
                </td>
                <td style="padding:12px;font-family:'Newsreader',serif;font-size:13px;color:#18181b;">
                  ${
                    s.adminEmail
                      ? `${escapar(s.adminNome ?? "")} <br/><span style="font-family:ui-monospace,monospace;font-size:11px;color:#71717a;">${escapar(s.adminEmail)}</span>`
                      : '<span style="color:#71717a;">—</span>'
                  }
                  ${
                    s.erroAdmin
                      ? `<div style="color:#dc2626;font-size:11px;font-weight:600;margin-top:2px;">Erro: ${escapar(s.erroAdmin)}</div>`
                      : ""
                  }
                </td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>
      </div>`
      : "";

  const htmlUtilizadores =
    utilizadores.length > 0
      ? `
      <div style="margin-bottom: 24px;">
        <h3 style="font-family:'Newsreader',serif;font-size:16px;font-weight:600;color:#18181b;margin:0 0 10px;">
          👥 Novos Utilizadores Integrados (${utilizadores.length})
        </h3>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
               style="background:#ffffff;border:1px solid #e4e4e7;border-radius:6px;border-collapse:collapse;">
          <thead>
            <tr style="background:#f4f4f5;border-bottom:1px solid #e4e4e7;">
              <th style="padding:10px 12px;font-family:ui-monospace,monospace;font-size:11px;text-align:left;color:#71717a;text-transform:uppercase;">Utilizador</th>
              <th style="padding:10px 12px;font-family:ui-monospace,monospace;font-size:11px;text-align:left;color:#71717a;text-transform:uppercase;">Sociedade</th>
              <th style="padding:10px 12px;font-family:ui-monospace,monospace;font-size:11px;text-align:left;color:#71717a;text-transform:uppercase;">Perfil</th>
            </tr>
          </thead>
          <tbody>
            ${utilizadores
              .map(
                (u, idx) => `
              <tr style="${idx > 0 ? "border-top:1px solid #e4e4e7;" : ""}">
                <td style="padding:12px;font-family:'Newsreader',serif;font-size:13px;color:#18181b;">
                  <strong>${escapar(u.nome)}</strong><br/>
                  <span style="font-family:ui-monospace,monospace;font-size:12px;color:#71717a;">${escapar(u.email)}</span>
                </td>
                <td style="padding:12px;font-family:'Newsreader',serif;font-size:13px;color:#18181b;">
                  ${escapar(u.sociedadeNome ?? "Plataforma")}
                </td>
                <td style="padding:12px;font-family:'Newsreader',serif;font-size:12px;color:#18181b;">
                  <span style="display:inline-block;padding:2px 6px;background:#e4e4e7;border-radius:4px;font-family:ui-monospace,monospace;font-size:11px;">
                    ${escapar(rotuloPapel(u.papel))}
                  </span>
                </td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>
      </div>`
      : "";

  return `
    <!DOCTYPE html>
    <html lang="pt">
    <head><meta charset="utf-8"/><title>Resumo Diário</title></head>
    <body style="margin:0;padding:24px;background:#f4f4f5;font-family:'Newsreader',Georgia,serif;color:#18181b;">
      <div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e4e4e7;border-radius:8px;padding:32px;">
        <div style="border-bottom:2px solid #233d34;padding-bottom:16px;margin-bottom:24px;">
          <span style="display:inline-block;padding:4px 8px;background:#233d34;color:#ffffff;border-radius:4px;font-family:ui-monospace,monospace;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;">
            Resumo Diário
          </span>
          <h1 style="font-size:22px;margin:12px 0 4px;color:#18181b;">Resumo Operacional Terlica</h1>
          <p style="font-size:13px;color:#71717a;margin:0;">Atividade até às 09:00 de ${escapar(dataExtenso)}</p>
        </div>

        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:24px;">
          <tr>
            <td width="32%" style="background:#fafafa;border:1px solid #e4e4e7;border-radius:6px;padding:12px;text-align:center;">
              <div style="font-family:ui-monospace,monospace;font-size:10px;text-transform:uppercase;color:#71717a;">Novas Sociedades</div>
              <div style="font-size:22px;font-weight:700;color:#18181b;margin-top:4px;">${sociedades.length}</div>
            </td>
            <td width="2%"></td>
            <td width="32%" style="background:#fafafa;border:1px solid #e4e4e7;border-radius:6px;padding:12px;text-align:center;">
              <div style="font-family:ui-monospace,monospace;font-size:10px;text-transform:uppercase;color:#71717a;">Novos Utilizadores</div>
              <div style="font-size:22px;font-weight:700;color:#18181b;margin-top:4px;">${utilizadores.length}</div>
            </td>
            <td width="2%"></td>
            <td width="32%" style="background:#fafafa;border:1px solid #e4e4e7;border-radius:6px;padding:12px;text-align:center;">
              <div style="font-family:ui-monospace,monospace;font-size:10px;text-transform:uppercase;color:#71717a;">Processos (24h)</div>
              <div style="font-size:22px;font-weight:700;color:#18181b;margin-top:4px;">${totalProcessos}</div>
            </td>
          </tr>
        </table>

        ${htmlSociedades}
        ${htmlUtilizadores}

        <div style="margin-top:28px;text-align:center;">
          <a href="${hrefAdmin}" style="display:inline-block;padding:12px 24px;background:#233d34;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;">
            Aceder ao Painel de Administração
          </a>
        </div>
      </div>
    </body>
    </html>
  `;
}

/* ---------------------------------------------------------------- Envio */

async function enviar({ para, assunto, html }) {
  const canais = [];

  if (chaveBrevo) {
    canais.push({
      nome: "Brevo",
      chave: "brevo",
      campoId: "messageId",
      url: "https://api.brevo.com/v3/smtp/email",
      cabecalhos: { "api-key": chaveBrevo, "Content-Type": "application/json" },
      corpo: {
        sender: { email: remetente },
        to: [{ email: para }],
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
      url: "https://api.mailjet.com/v3.1/send",
      cabecalhos: {
        Authorization: "Basic " + Buffer.from(`${chaveMailjet}:${segredoMailjet}`).toString("base64"),
        "Content-Type": "application/json",
      },
      corpo: {
        Messages: [
          {
            From: { Email: remetente, Name: "LexFlow" },
            To: [{ Email: para }],
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
      url: "https://api.resend.com/emails",
      cabecalhos: {
        Authorization: "Bearer " + chaveResend,
        "Content-Type": "application/json",
      },
      corpo: { from: remetente, to: [para], subject: assunto, html },
    });
  }

  if (chaveTwilio) {
    canais.push({
      nome: "Twilio SendGrid",
      chave: "twilio_sendgrid",
      campoId: "x-message-id",
      url: "https://api.sendgrid.com/v3/mail/send",
      cabecalhos: {
        Authorization: "Bearer " + chaveTwilio,
        "Content-Type": "application/json",
      },
      corpo: {
        personalizations: [{ to: [{ email: para }] }],
        from: { email: remetente },
        subject: assunto,
        content: [{ type: "text/html", value: html }],
      },
    });
  }

  if (anfitriaoSmtp) {
    canais.push({ nome: "SMTP", tipo: "smtp", anfitriao: anfitriaoSmtp, porta: portaSmtp, chave: "smtp" });
  }

  if (canais.length === 0) {
    return { ok: false, erro: "Nenhum canal de envio configurado no ambiente." };
  }

  for (const canal of canais) {
    const r = await tentar(canal, { para, assunto, html });
    if (r.ok) return { ...r, nome: canal.nome, canal: canal.chave };
  }

  return { ok: false, erro: "Todos os canais de envio falharam.", canal: null, mensagemId: null };
}

async function tentar(canal, { para, assunto, html }) {
  if (canal.tipo === "smtp") {
    return new Promise((resolver) => {
      const socket = connect({ host: canal.anfitriao, port: canal.porta });
      const corpo = [
        `From: LexFlow <${remetente}>`,
        `To: <${para}>`,
        `Subject: ${assunto}`,
        "MIME-Version: 1.0",
        "Content-Type: text/html; charset=UTF-8",
        "",
        html,
      ].join("\r\n");

      const temporizador = setTimeout(() => {
        socket.destroy();
        resolver({ ok: false, erro: `Timeout SMTP ${canal.anfitriao}` });
      }, TEMPO_LIMITE_MS);

      socket.on("connect", () => socket.write("EHLO localhost\r\n"));

      let etapa = 0;
      socket.on("data", (dados) => {
        const txt = dados.toString();
        if (etapa === 0 && txt.startsWith("220")) {
          etapa = 1;
          socket.write(`MAIL FROM:<${remetente}>\r\n`);
        } else if (etapa === 1 && txt.startsWith("250")) {
          etapa = 2;
          socket.write(`RCPT TO:<${para}>\r\n`);
        } else if (etapa === 2 && txt.startsWith("250")) {
          etapa = 3;
          socket.write("DATA\r\n");
        } else if (etapa === 3 && txt.startsWith("354")) {
          etapa = 4;
          socket.write(corpo + "\r\n.\r\n");
        } else if (etapa === 4 && txt.startsWith("250")) {
          etapa = 5;
          socket.write("QUIT\r\n");
        } else if (etapa === 5 && txt.startsWith("221")) {
          clearTimeout(temporizador);
          socket.destroy();
          resolver({ ok: true, mensagemId: null });
        }
      });

      socket.on("error", (e) => {
        clearTimeout(temporizador);
        resolver({ ok: false, erro: e.message });
      });
    });
  }

  try {
    const resposta = await fetch(canal.url, {
      method: "POST",
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      headers: canal.cabecalhos,
      body: JSON.stringify(canal.corpo),
    });

    const corpo = await resposta.text();
    if (!resposta.ok) {
      return { ok: false, erro: `${canal.nome} erro ${resposta.status}: ${corpo}` };
    }

    let mensagemId = null;
    try {
      const json = JSON.parse(corpo);
      mensagemId = json?.[canal.campoId] ?? json?.Messages?.[0]?.To?.[0]?.MessageID ?? json?.id ?? null;
    } catch {
      /* não json */
    }

    return { ok: true, erro: null, mensagemId };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }
}
