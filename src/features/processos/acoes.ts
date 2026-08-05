"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { contadorReferencia, organizacao } from "@/db/schema/organizacao";
import { processoOnboarding } from "@/db/schema/processo";
import { dadosFaturacao, dadosIdentificacao } from "@/db/schema/seccoes";
import { registarEvento } from "@/features/auditoria/registar";
import { enviarEmail } from "@/lib/email";
import { podeAprovarRiscoElevado, sessaoAtual } from "@/lib/sessao";
import { expiraDaquiA, gerarToken, hashToken } from "@/lib/token";

/**
 * Cria um processo e devolve o link mágico.
 *
 * O token em claro é devolvido uma única vez, aqui — depois disto só existe o
 * hash na base de dados. Quem perder o link pede outro; ninguém o recupera.
 */
export async function criarProcesso(tipoCliente: "particular" | "empresa" = "particular") {
  const base = db();

  const [org] = await base.select().from(organizacao).limit(1);
  if (!org) {
    return { ok: false as const, erro: "Não há organização criada. Corra `pnpm db:seed`." };
  }

  const ano = new Date().getFullYear();

  // Sequencial atómico: um UPDATE ... RETURNING não deixa dois processos
  // apanharem o mesmo número, ao contrário de um SELECT max()+1.
  await base
    .insert(contadorReferencia)
    .values({ organizacaoId: org.id, ano, ultimo: 0 })
    .onConflictDoNothing({ target: [contadorReferencia.organizacaoId, contadorReferencia.ano] });

  const token = gerarToken();

  let processo: typeof processoOnboarding.$inferSelect | undefined;
  let referencia = "";

  for (let tentativa = 1; tentativa <= 5; tentativa++) {
    const [contador] = await base
      .update(contadorReferencia)
      .set({ ultimo: sql`${contadorReferencia.ultimo} + 1` })
      .where(
        and(eq(contadorReferencia.organizacaoId, org.id), eq(contadorReferencia.ano, ano)),
      )
      .returning({ ultimo: contadorReferencia.ultimo });

    referencia = `${org.prefixoReferencia}-${ano}-${String(contador.ultimo).padStart(4, "0")}`;

    try {
      [processo] = await base
        .insert(processoOnboarding)
        .values({
          organizacaoId: org.id,
          referencia,
          tipoCliente,
          tokenAcessoHash: hashToken(token),
          expiraEm: expiraDaquiA(30),
        })
        .returning();
      break;
    } catch (erro) {
      if ((erro as { code?: string }).code === "23505" && tentativa < 5) {
        continue;
      }
      if ((erro as { code?: string }).code === "23505") {
        return {
          ok: false as const,
          erro: "Não foi possível criar o processo. Tente novamente.",
        };
      }
      throw erro;
    }
  }

  if (!processo) {
    return { ok: false as const, erro: "Não foi possível criar o processo. Tente novamente." };
  }

  const h = await headers();
  await registarEvento({
    organizacaoId: org.id,
    processoId: processo.id,
    acao: "processo.criado",
    entidade: "processo_onboarding",
    entidadeId: processo.id,
    valorNovo: { referencia, tipoCliente },
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent") ?? null,
  });

  revalidatePath("/");
  return { ok: true as const, referencia, token, processoId: processo.id };
}

export type ResultadoDecisao = { ok: true } | { ok: false; erro: string };

type EstadoDecisao = "em_revisao" | "aprovado" | "rejeitado";

const ROTULO_ESTADO: Record<EstadoDecisao, string> = {
  em_revisao: "processo.em_revisao",
  aprovado: "processo.aprovado",
  rejeitado: "processo.rejeitado",
};

/**
 * Decide um processo: marca em revisão, aprova ou rejeita.
 *
 * Só sócio ou admin — a mesma regra que já gatilha o aviso "risco elevado por
 * aprovar" no painel. Um rascunho não chega aqui (o cliente nem submeteu), e
 * uma decisão já tomada é definitiva: não volta a rascunho nem muda de sentido.
 */
export async function alterarEstadoProcesso(
  processoId: string,
  novoEstado: EstadoDecisao,
): Promise<ResultadoDecisao> {
  const sessao = await sessaoAtual();
  if (!sessao) {
    return { ok: false, erro: "Sessão expirada. Entre novamente." };
  }
  if (!podeAprovarRiscoElevado(sessao.eu.papel)) {
    return { ok: false, erro: "Só sócio ou admin podem aprovar." };
  }

  const base = db();
  const [processo] = await base
    .select()
    .from(processoOnboarding)
    .where(and(eq(processoOnboarding.id, processoId), isNull(processoOnboarding.apagadoEm)))
    .limit(1);

  if (!processo) {
    return { ok: false, erro: "Processo não encontrado." };
  }
  if (processo.estado === "rascunho" || processo.estado === "pendente_cliente") {
    return { ok: false, erro: "Um processo que o cliente ainda não submeteu não pode ser decidido." };
  }
  if (processo.estado === "aprovado" || processo.estado === "rejeitado") {
    return { ok: false, erro: "Este processo já foi decidido e não pode ser alterado." };
  }

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = h.get("user-agent") ?? null;

  await base
    .update(processoOnboarding)
    .set({
      estado: novoEstado,
      responsavelId: sessao.eu.id,
      ...(novoEstado === "aprovado"
        ? { aprovadoEm: new Date(), aprovadoPor: sessao.eu.id }
        : {}),
    })
    .where(eq(processoOnboarding.id, processoId));

  await registarEvento({
    organizacaoId: processo.organizacaoId,
    processoId: processo.id,
    atorId: sessao.eu.id,
    acao: ROTULO_ESTADO[novoEstado],
    entidade: "processo_onboarding",
    entidadeId: processo.id,
    valorAnterior: { estado: processo.estado },
    valorNovo: { estado: novoEstado, responsavel: sessao.eu.nome },
    ip,
    userAgent,
  });

  if (novoEstado === "aprovado" || novoEstado === "rejeitado") {
    await notificarDecisao(processo, novoEstado);
  }

  revalidatePath(`/processos/${processoId}`);
  revalidatePath("/processos");
  return { ok: true };
}

/**
 * Email ao cliente com a decisão. Nunca a razão: um rejeitado não pode
 * transformar-se num roteiro para contornar a diligência na próxima tentativa.
 */
async function notificarDecisao(
  processo: typeof processoOnboarding.$inferSelect,
  estado: "aprovado" | "rejeitado",
) {
  const base = db();

  const [identificacao] = await base
    .select({ email: dadosIdentificacao.email })
    .from(dadosIdentificacao)
    .where(eq(dadosIdentificacao.processoId, processo.id))
    .limit(1);

  const [faturacao] = await base
    .select({ email: dadosFaturacao.email })
    .from(dadosFaturacao)
    .where(eq(dadosFaturacao.processoId, processo.id))
    .limit(1);

  const emailCliente = identificacao?.email ?? faturacao?.email;
  if (!emailCliente) return;

  const conteudo =
    estado === "aprovado"
      ? { assunto: `Processo ${processo.referencia} aprovado`, texto: "O seu processo foi aprovado." }
      : {
          assunto: `Processo ${processo.referencia} não aprovado`,
          texto: "Foi identificada informação em falta; a nossa equipa entrará em contacto.",
        };

  const resultado = await enviarEmail({
    para: emailCliente,
    assunto: conteudo.assunto,
    html: `<p>${conteudo.texto}</p>`,
  });

  if (!resultado.ok) {
    console.error("[email] falha ao notificar decisão", resultado.erro);
  }
}
