import "server-only";
import { db } from "@/db";
import { emailLog } from "@/db/schema/email";
import type { templateEmail } from "@/db/schema/enums";
import { env } from "@/env";

export type ResultadoEnvio = { ok: true } | { ok: false; erro: string };

export type TemplateEmail = (typeof templateEmail.enumValues)[number];

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
  /**
   * Que email é este. Obrigatório de propósito: é o que garante que um caminho
   * de envio novo não pode nascer sem entrar no diário — quem o escrever tem de
   * responder à pergunta para o código compilar.
   */
  template: TemplateEmail;
  organizacaoId?: string | null;
  processoId?: string | null;
  /**
   * SHA-256 do token do link mágico, quando o email leva um. Nunca o token em
   * claro — ver a nota na coluna, em `db/schema/email.ts`.
   */
  tokenHash?: string | null;
};

/**
 * Escreve a linha do diário. Não lança, nunca.
 *
 * Um email que saiu e não ficou registado é mau; um email que não saiu *porque*
 * o registo falhou é pior. A gravação é o último passo e o erro dela fica-se
 * pela consola: o valor desta tabela é operacional, não legal — o que a lei
 * obriga a conservar está em `evento_auditoria`, noutro caminho de escrita.
 */
async function registar(
  p: ParametrosEmail,
  resultado: ResultadoEnvio,
): Promise<void> {
  try {
    await db()
      .insert(emailLog)
      .values({
        organizacaoId: p.organizacaoId ?? null,
        processoId: p.processoId ?? null,
        para: p.para,
        assunto: p.assunto,
        template: p.template,
        tokenHash: p.tokenHash ?? null,
        estado: resultado.ok ? "enviado" : "erro",
        // O erro é truncado: a resposta de um fornecedor pode vir com um corpo
        // inteiro, e a coluna serve para diagnosticar, não para arquivar HTML.
        erro: resultado.ok ? null : resultado.erro.slice(0, 2000),
      });
  } catch (e) {
    console.error("[email] o envio não ficou registado em email_log", e);
  }
}

/**
 * Envio de email transacional via Resend. Nunca deixa o fluxo rebentar: sem
 * chave configurada, fica-se pelo log; qualquer erro na chamada é apanhado e
 * devolvido, não propagado.
 *
 * Todos os caminhos de saída passam por `registar` — incluindo o da chave que
 * falta e o da exceção. É a única forma de a pergunta "o cliente recebeu
 * alguma coisa?" ter resposta quando a resposta é "não".
 */
export async function enviarEmail(p: ParametrosEmail): Promise<ResultadoEnvio> {
  const resultado = await tentarEnviar(p);
  await registar(p, resultado);
  return resultado;
}

async function tentarEnviar({
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
