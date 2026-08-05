import "server-only";
import { env } from "@/env";

export type ResultadoEnvio = { ok: true } | { ok: false; erro: string };

type ParametrosEmail = {
  para: string;
  assunto: string;
  html: string;
};

/**
 * Envio de email transacional via Resend. Nunca deixa o fluxo rebentar: sem
 * chave configurada, fica-se pelo log; qualquer erro na chamada é apanhado e
 * devolvido, não propagado.
 */
export async function enviarEmail({ para, assunto, html }: ParametrosEmail): Promise<ResultadoEnvio> {
  const ambiente = env();

  if (!ambiente.RESEND_API_KEY) {
    console.log(`[email] (sem chave) para=${para} assunto="${assunto}"`);
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
