import "server-only";
import { env } from "@/env";

export type ResultadoEnvio = { ok: true } | { ok: false; erro: string };

export type AnexoEmail = {
  /** Nome com que o anexo chega à caixa de correio do cliente. */
  nome: string;
  conteudo: Buffer;
};

type ParametrosEmail = {
  para: string;
  assunto: string;
  html: string;
  anexos?: AnexoEmail[];
};

/**
 * Envio de email transacional via Resend. Nunca deixa o fluxo rebentar: sem
 * chave configurada, fica-se pelo log; qualquer erro na chamada é apanhado e
 * devolvido, não propagado.
 */
export async function enviarEmail({
  para,
  assunto,
  html,
  anexos,
}: ParametrosEmail): Promise<ResultadoEnvio> {
  const ambiente = env();

  if (!ambiente.RESEND_API_KEY) {
    const lista = anexos?.length ? ` anexos=${anexos.map((a) => a.nome).join(",")}` : "";
    console.log(`[email] (sem chave) para=${para} assunto="${assunto}"${lista}`);
    return { ok: false, erro: "RESEND_API_KEY não configurada" };
  }

  try {
    const resposta = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ambiente.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: ambiente.EMAIL_REMETENTE,
        to: [para],
        subject: assunto,
        html,
        // O Resend quer o conteúdo em base64. Só se inclui a chave quando há
        // anexos: um `attachments: []` faz a API responder 422.
        ...(anexos?.length
          ? {
              attachments: anexos.map((a) => ({
                filename: a.nome,
                content: a.conteudo.toString("base64"),
              })),
            }
          : {}),
      }),
    });

    if (!resposta.ok) {
      const corpo = await resposta.text();
      return { ok: false, erro: `Resend devolveu ${resposta.status}: ${corpo}` };
    }

    return { ok: true };
  } catch (erro) {
    return { ok: false, erro: erro instanceof Error ? erro.message : String(erro) };
  }
}
