import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { notificacao, notificacoesPendentes } from "@/db/schema/notificacao";
import { organizacao } from "@/db/schema/organizacao";
import { eSuperAdmin } from "@/lib/sessao";

export type ItemNotificacao = {
  id: string;
  organizacaoId: string | null;
  organizacaoNome?: string | null;
  paraPapel: string | null;
  titulo: string;
  corpo: string;
  link: string | null;
  lidaEm: Date | null;
  criadoEm: Date;
};

/**
 * Consulta as notificações in-app para o utilizador autenticado.
 *
 * - O `super_admin` vê todas as notificações da plataforma (transversais a todas as sociedades).
 * - Os utilizadores com sociedade (`society_admin`, `gestor`, `utilizador`) veem as notificações
 *   da sua organização (ou notificações globais dirigidas ao seu papel).
 */
export async function consultarNotificacoes(
  eu: { papel: string; organizacaoId: string | null },
  { limite = 50, apenasNaoLidas = false }: { limite?: number; apenasNaoLidas?: boolean } = {},
): Promise<ItemNotificacao[]> {
  const superAdmin = eSuperAdmin(eu.papel);

  if (superAdmin) {
    const condicoes = [];
    if (apenasNaoLidas) condicoes.push(isNull(notificacao.lidaEm));

    const rows = await db()
      .select({
        id: notificacao.id,
        organizacaoId: notificacao.organizacaoId,
        organizacaoNome: organizacao.nome,
        paraPapel: notificacao.paraPapel,
        titulo: notificacao.titulo,
        corpo: notificacao.corpo,
        link: notificacao.link,
        lidaEm: notificacao.lidaEm,
        criadoEm: notificacao.criadoEm,
      })
      .from(notificacao)
      .leftJoin(organizacao, eq(notificacao.organizacaoId, organizacao.id))
      .where(condicoes.length > 0 ? and(...condicoes) : undefined)
      .orderBy(desc(notificacao.criadoEm))
      .limit(limite);

    return rows;
  }

  if (!eu.organizacaoId) return [];

  const condicoesFiltro = [
    or(
      eq(notificacao.organizacaoId, eu.organizacaoId),
      isNull(notificacao.organizacaoId),
    ),
    or(
      isNull(notificacao.paraPapel),
      eq(notificacao.paraPapel, eu.papel),
      eq(notificacao.paraPapel, "sociedade"),
    ),
  ];

  if (apenasNaoLidas) {
    condicoesFiltro.push(isNull(notificacao.lidaEm));
  }

  const rows = await db()
    .select({
      id: notificacao.id,
      organizacaoId: notificacao.organizacaoId,
      organizacaoNome: organizacao.nome,
      paraPapel: notificacao.paraPapel,
      titulo: notificacao.titulo,
      corpo: notificacao.corpo,
      link: notificacao.link,
      lidaEm: notificacao.lidaEm,
      criadoEm: notificacao.criadoEm,
    })
    .from(notificacao)
    .leftJoin(organizacao, eq(notificacao.organizacaoId, organizacao.id))
    .where(and(...condicoesFiltro))
    .orderBy(desc(notificacao.criadoEm))
    .limit(limite);

  return rows;
}

/**
 * Conta o número de notificações não lidas para o utilizador autenticado (para o badge do sino).
 */
export async function contarNotificacoesNaoLidas(eu: {
  papel: string;
  organizacaoId: string | null;
}): Promise<number> {
  const superAdmin = eSuperAdmin(eu.papel);

  if (superAdmin) {
    const [resultado] = await db()
      .select({ contagem: sql<number>`count(*)::int` })
      .from(notificacao)
      .where(isNull(notificacao.lidaEm));

    return Number(resultado?.contagem ?? 0);
  }

  if (!eu.organizacaoId) return 0;

  const [resultado] = await db()
    .select({ contagem: sql<number>`count(*)::int` })
    .from(notificacao)
    .where(
      and(
        isNull(notificacao.lidaEm),
        or(
          eq(notificacao.organizacaoId, eu.organizacaoId),
          isNull(notificacao.organizacaoId),
        ),
        or(
          isNull(notificacao.paraPapel),
          eq(notificacao.paraPapel, eu.papel),
          eq(notificacao.paraPapel, "sociedade"),
        ),
      ),
    );

  return Number(resultado?.contagem ?? 0);
}

/**
 * Consulta a lista de notificações pendentes para processamento do resumo diário.
 */
export async function consultarNotificacoesPendentes(limite = 500) {
  return db()
    .select()
    .from(notificacoesPendentes)
    .where(isNull(notificacoesPendentes.processadoEm))
    .orderBy(notificacoesPendentes.criadoEm)
    .limit(limite);
}
