import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:net";
import { enviarSmtp } from "./smtp";

/**
 * Servidor SMTP falso em TCP local: responde o que um postfix responderia e
 * guarda o corpo da mensagem para o teste inspecionar o MIME.
 */
function servidorFalso(respostas: Record<string, string> = {}, recolher: { corpo?: string } = {}): Promise<{ servidor: Server; porta: number }> {
  return new Promise((resolver) => {
    const servidor = createServer((socket) => {
      let linha = "";
      const responder = (texto: string) => socket.write(`${texto}\r\n`);
      responder(respostas.banner ?? "220 mail.terlicalabs.com ESMTP");
      socket.on("data", (dados) => {
        linha += dados.toString();
        while (linha.includes("\r\n")) {
          const comando = linha.slice(0, linha.indexOf("\r\n"));
          linha = linha.slice(linha.indexOf("\r\n") + 2);
          if (comando === "EHLO terlicalabs.com") responder("250 mail.terlicalabs.com");
          else if (comando === "MAIL FROM:<poc@terlicalabs.com>") responder(respostas.mail ?? "250 2.1.0 Ok");
          else if (comando.startsWith("RCPT TO:")) responder(respostas.rcpt ?? "250 2.1.5 Ok");
          else if (comando === "DATA") responder("354 End data with <CR><LF>.<CR><LF>");
          else if (comando === ".") responder(respostas.corpo ?? "250 2.0.0 Ok: queued as A1B2");
          else if (comando === "QUIT") {
            responder("221 2.0.0 Bye");
            socket.end();
          } else if (comando.startsWith("Subject:") || comando.startsWith("Content-") || comando.startsWith("From:") || comando.startsWith("To:") || comando.startsWith("MIME-") || comando === "" || comando.startsWith("--") || comando.startsWith("PGh0bWw") || comando.startsWith("JVBER")) {
            // corpo da mensagem — acumula
            recolher.corpo = (recolher.corpo ?? "") + comando + "\n";
          }
        }
      });
    });
    servidor.listen(0, "127.0.0.1", () => {
      resolver({ servidor, porta: (servidor.address() as { port: number }).port });
    });
  });
}

const servidores: Server[] = [];

afterEach(() => {
  for (const s of servidores) s.close();
  servidores.length = 0;
});

describe("enviarSmtp", () => {
  it("entrega a mensagem com anexo e devolve ok", async () => {
    const recolher: { corpo?: string } = {};
    const { servidor, porta } = await servidorFalso({}, recolher);
    servidores.push(servidor);

    const r = await enviarSmtp("127.0.0.1", porta, {
      de: "poc@terlicalabs.com",
      para: "cliente@exemplo.pt",
      assunto: "Assunto de teste",
      html: "<p>Olá</p>",
      anexos: [{ nome: "relatorio.pdf", conteudoBase64: "JVBERi0xLjQ=" }],
    });

    expect(r).toEqual({ ok: true });
    expect(recolher.corpo).toContain("Subject: Assunto de teste");
    expect(recolher.corpo).toContain("multipart/mixed");
    expect(recolher.corpo).toContain('name="relatorio.pdf"');
    expect(recolher.corpo).toContain("JVBERi0xLjQ=");
  });

  it("devolve erro quando o destinatário é recusado (550)", async () => {
    const { servidor, porta } = await servidorFalso({ rcpt: "550 5.1.1 No such user" });
    servidores.push(servidor);

    const r = await enviarSmtp("127.0.0.1", porta, {
      de: "poc@terlicalabs.com",
      para: "naoexiste@exemplo.pt",
      assunto: "x",
      html: "<p>x</p>",
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toContain("destinatário recusado");
  });
});
