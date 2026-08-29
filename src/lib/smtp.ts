import { createConnection } from "node:net";

/**
 * Cliente SMTP mínimo para o canal próprio (postfix no servidor do cliente).
 * Sem nodemailer (registo de dependências no Windows partido); o SMTP de
 * saída da VPS aceita ligações da rede Docker sem autenticação, protocolo
 * pequeno: EHLO → MAIL FROM → RCPT TO → DATA → QUIT. Sem TLS — só rede interna.
 */

export interface MensagemSmtp {
  de: string;
  para: string;
  assunto: string;
  html: string;
  anexos?: { nome: string; conteudoBase64: string }[];
}

const BOUNDARY = "----=_limite_7f3a";
const TIMEOUT_MS = 15_000;

/**
 * Nome com que se saúda o relay (RFC 5321 pede o FQDN do cliente). Domínio
 * vem de `EMAIL_REMETENTE`, não fixo no código; sem domínio utilizável recua
 * para `localhost`, aceite pelo relay na rede interna.
 */
function saudacao(de: string): string {
  const dominio = de.split("@")[1]?.trim().toLowerCase() ?? "";
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(dominio) ? dominio : "localhost";
}

/** Remove quebras de linha e byte NUL dos cabeçalhos — previne injeção CRLF (Bcc falsificado). */
export function sanitizarCabecalho(valor: string): string {
  return (valor ?? "").replace(/[\r\n\0]/g, " ").trim();
}

function codificarMensagem(m: MensagemSmtp): string {
  const de = sanitizarCabecalho(m.de);
  const para = sanitizarCabecalho(m.para);
  const assunto = sanitizarCabecalho(m.assunto);

  const cabecalhos = [
    `From: JMASSANO <${de}>`,
    `To: <${para}>`,
    `Subject: ${assunto}`,
    "MIME-Version: 1.0",
  ];

  const partes: string[] = [];
  if (m.anexos?.length) {
    cabecalhos.push(`Content-Type: multipart/mixed; boundary="${BOUNDARY}"`);
    partes.push(`--${BOUNDARY}`, "Content-Type: text/html; charset=UTF-8", "", m.html);
    for (const a of m.anexos) {
      const tipo = a.nome.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream";
      partes.push(
        `--${BOUNDARY}`,
        `Content-Type: ${tipo}; name="${sanitizarCabecalho(a.nome)}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${sanitizarCabecalho(a.nome)}"`,
        "",
        a.conteudoBase64,
      );
    }
    partes.push(`--${BOUNDARY}--`, "");
  } else {
    cabecalhos.push("Content-Type: text/html; charset=UTF-8");
    partes.push(m.html);
  }

  return cabecalhos.join("\r\n") + "\r\n\r\n" + partes.join("\r\n");
}

/** Opens the socket, exchanges the SMTP lines and resolves with the final state. */
export function enviarSmtp(anfitriao: string, porta: number, mensagem: MensagemSmtp): Promise<{ ok: boolean; erro?: string }> {
  return new Promise((resolver) => {
    const deSeguro = sanitizarCabecalho(mensagem.de);
    const paraSeguro = sanitizarCabecalho(mensagem.para);
    const socket = createConnection({ host: anfitriao, port: porta });
    const corpo = codificarMensagem(mensagem);
    let pausa = false;
    let encerrado = false;

    const terminar = (ok: boolean, erro?: string) => {
      if (encerrado) return;
      encerrado = true;
      socket.destroy();
      resolver(ok ? { ok: true } : { ok: false, erro });
    };

    const temporizador = setTimeout(() => terminar(false, `O servidor SMTP ${anfitriao}:${porta} não respondeu em ${TIMEOUT_MS / 1000}s.`), TIMEOUT_MS);

    socket.on("connect", () => socket.write(`EHLO ${saudacao(deSeguro)}\r\n`));

    let linha = "";
    const comandos = [
      /^MAIL FROM:</, // 250
      /^RCPT TO:</, // 250
      /^DATA$/, // 354
      /^\.$/, // 250
      /^QUIT$/, // 221
    ];
    let indiceComando = 0;

    socket.on("data", (dados) => {
      linha += dados.toString();
      while (linha.includes("\r\n")) {
        const resposta = linha.slice(0, linha.indexOf("\r\n"));
        linha = linha.slice(linha.indexOf("\r\n") + 2);
        const codigo = resposta.slice(0, 3);
        // Hyphenated replies continue (multiline) — only act on the final space.
        if (resposta[3] === "-") continue;

        if (indiceComando === 0) {
          // 220 from the banner → EHLO was already sent on connect; wait for the 250.
          if (codigo === "220") continue;
          if (codigo !== "250") return terminar(false, `SMTP: EHLO recusado (${codigo}) — ${resposta}`);
          indiceComando = 1;
          socket.write(`MAIL FROM:<${deSeguro}>\r\n`);
        } else if (indiceComando === 1) {
          if (codigo !== "250") return terminar(false, `SMTP: remetente recusado (${codigo}) — ${resposta}`);
          indiceComando = 2;
          socket.write(`RCPT TO:<${paraSeguro}>\r\n`);
        } else if (indiceComando === 2) {
          if (codigo !== "250") return terminar(false, `SMTP: destinatário recusado (${codigo}) — ${resposta}`);
          indiceComando = 3;
          socket.write(`DATA\r\n`);
        } else if (indiceComando === 3) {
          if (codigo !== "354") return terminar(false, `SMTP: DATA recusado (${codigo}) — ${resposta}`);
          indiceComando = 4;
          socket.write(corpo.replace(/\r\n\./g, "\r\n..") + "\r\n.\r\n");
        } else if (indiceComando === 4) {
          if (codigo !== "250") return terminar(false, `SMTP: corpo recusado (${codigo}) — ${resposta}`);
          indiceComando = 5;
          socket.write(`QUIT\r\n`);
        } else if (indiceComando === 5) {
          if (codigo !== "221") return terminar(false, `SMTP: QUIT inesperado (${codigo}) — ${resposta}`);
          clearTimeout(temporizador);
          terminar(true);
        }
      }
    });

    socket.on("error", (erro) => terminar(false, `SMTP ${anfitriao}:${porta}: ${erro.message}`));
    socket.on("close", () => {
      if (!encerrado) clearTimeout(temporizador);
    });
  });
}
