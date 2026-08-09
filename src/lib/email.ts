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
 * Quanto tempo se espera pelo Resend antes de desistir.
 *
 * Sem isto, uma saída para a Internet fechada no servidor não dava erro nenhum:
 * o `fetch` ficava pendurado, e com ele a Server Action que estava a criar o
 * processo — o utilizador ficava com o botão em "A criar…" para sempre e não
 * havia linha nenhuma no diário a dizer porquê. Um envio que demora mais de
 * quinze segundos já falhou; o que falta é dizê-lo.
 */
const TEMPO_LIMITE_MS = 15_000;

/**
 * Escreve a linha do diário. Não lança, nunca.
 *
 * Um email que saiu e não ficou registado é mau; um email que não saiu *porque*
 * o registo falhou é pior. A gravação é o último passo e o erro dela fica-se
 * pela consola: o valor desta tabela é operacional, não legal — o que a lei
 * obriga a conservar está em `evento_auditoria`, noutro caminho de escrita.
 *
 * O erro é gritado com o destinatário e o template à frente, e não só com a
 * exceção. Uma gravação falhada deixa o `/emails` a dizer "0 mensagens", que é
 * exatamente o que se vê quando o envio nem sequer foi tentado: sem esta linha
 * na consola, os dois casos são indistinguíveis de fora — e foi a confundi-los
 * que se perdeu uma investigação inteira.
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
    console.error(
      `[email] FALHOU a gravação em email_log — template=${p.template} para=${p.para} ` +
        `estado=${resultado.ok ? "enviado" : "erro"}. O /emails vai mostrar menos ` +
        `mensagens do que as que foram tentadas.`,
      e,
    );
  }
}

/**
 * Envio de email transacional via Resend. Nunca deixa o fluxo rebentar: sem
 * chave configurada, fica-se pelo log; qualquer erro na chamada é apanhado e
 * devolvido, não propagado.
 *
 * Todos os caminhos de saída passam por `registar` — incluindo o da chave que
 * falta, o da exceção e o do próprio `tentarEnviar` a rebentar. É a única forma
 * de a pergunta "o cliente recebeu alguma coisa?" ter resposta quando a
 * resposta é "não".
 *
 * O `try` à volta do `tentarEnviar` não é zelo a mais. Ele lê o ambiente antes
 * de entrar no seu próprio `try` (`env()` lança quando falta uma variável), e
 * uma exceção aí saltava por cima do `registar` **e** propagava-se a quem
 * chamou — que é como um envio falhado se transformava em criação de processo
 * falhada, sem deixar rasto em lado nenhum.
 */
export async function enviarEmail(p: ParametrosEmail): Promise<ResultadoEnvio> {
  let resultado: ResultadoEnvio;
  try {
    resultado = await tentarEnviar(p);
  } catch (erro) {
    resultado = {
      ok: false,
      erro: erro instanceof Error ? erro.message : String(erro),
    };
  }

  // Uma linha por tentativa, sempre, mesmo quando a gravação a seguir falha.
  // É o que permite responder a "chegou a tentar?" sem base de dados à mão —
  // a pergunta que o `/emails` a dizer "0 mensagens" não distingue de "tentou
  // e não gravou".
  if (resultado.ok) {
    console.info(`[email] enviado template=${p.template} para=${p.para}`);
  } else {
    console.error(
      `[email] NÃO enviado template=${p.template} para=${p.para}: ${resultado.erro}`,
    );
  }

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
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
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
      // O remetente entra na mensagem porque é a causa mais provável de um 403
      // e a que não se vê na resposta: o Resend recusa qualquer envio de um
      // domínio que não esteja verificado na conta, e `POC@jmassano.pt` é um
      // valor por omissão que ninguém escreveu e por isso ninguém desconfia.
      return {
        ok: false,
        erro: `Resend devolveu ${resposta.status} (de=${ambiente.EMAIL_REMETENTE}): ${corpo}`,
      };
    }

    return { ok: true };
  } catch (erro) {
    // O `AbortSignal.timeout` lança um `TimeoutError` cujo `message` é genérico
    // ("The operation was aborted due to timeout") e não diz a quem se estava a
    // ligar — num diário de emails isso não vale nada.
    if (erro instanceof Error && erro.name === "TimeoutError") {
      return {
        ok: false,
        erro: `A api.resend.com não respondeu em ${TEMPO_LIMITE_MS / 1000}s — verifique a saída para a Internet do servidor.`,
      };
    }
    return { ok: false, erro: erro instanceof Error ? erro.message : String(erro) };
  }
}
