import { createConnection } from "node:net";

/**
 * Cliente SMTP mínimo para o canal próprio (postfix no servidor do cliente).
 *
 * A escolha é deliberada: o projeto não usa nodemailer porque o registo de
 * dependências no Windows está partido, e o SMTP de saída do VPS aceita
 * ligações da rede do Docker sem autenticação (`mynetworks` no postfix), o que
 * torna o protocolo pequeno: EHLO → MAIL FROM → RCPT TO → DATA → QUIT.
 *
 * Sem autenticação nem TLS — só para a rede interna do servidor.
 */

export interface MensagemSmtp {
  de: string;
  para: string;
  assunto: string;
  html: string;
  anexos?: { nome: string; conteudoBase64: string }[];
}

const BOUNDARY = "----=_jmassano_7f3a";
const TIMEOUT_MS = 15_000;

function codificarMensagem(m: MensagemSmtp): string {
  const cabecalhos = [
    `From: JMASSANO <${m.de}>`,
    `To: <${m.para}>`,
    `Subject: ${m.assunto}`,
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
        `Content-Type: ${tipo}; name="${a.nome}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${a.nome}"`,
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

/** Liga o socket, troca as linhas SMTP e resolve com o estado final. */
export function enviarSmtp(anfitriao: string, porta: number, mensagem: MensagemSmtp): Promise<{ ok: boolean; erro?: string }> {
  return new Promise((resolver) => {
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

    socket.on("connect", () => socket.write(`EHLO terlicalabs.com\r\n`));

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
        // Respostas com hífen continuam (multilinha) — só agir no espaço final.
        if (resposta[3] === "-") continue;

        if (indiceComando === 0) {
          // 220 do banner → EHLO já foi enviado no connect; aguardar o 250.
          if (codigo === "220") continue;
          if (codigo !== "250") return terminar(false, `SMTP: EHLO recusado (${codigo}) — ${resposta}`);
          indiceComando = 1;
          socket.write(`MAIL FROM:<${mensagem.de}>\r\n`);
        } else if (indiceComando === 1) {
          if (codigo !== "250") return terminar(false, `SMTP: remetente recusado (${codigo}) — ${resposta}`);
          indiceComando = 2;
          socket.write(`RCPT TO:<${mensagem.para}>\r\n`);
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
