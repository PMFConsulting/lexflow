import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { db } from "@/db";
import { eventoAuditoria } from "@/db/schema/auditoria";
import { calcularHash, type EntradaAuditoria } from "./hash";

/**
 * Escreve uma linha no registo de auditoria, encadeada à anterior.
 *
 * A cadeia é por organização (decisão D6): uma cadeia global serializaria todas
 * as escritas do sistema num único ponto de contenção.
 *
 * Nota de concorrência: duas escritas simultâneas na mesma organização podiam
 * ler o mesmo `hash_anterior`. Numa POC com um punhado de utilizadores isso não
 * acontece; em produção isto passa a correr dentro de uma transação com
 * `SELECT ... FOR UPDATE` sobre a última linha, ou com um advisory lock por
 * organização. Fica assinalado de propósito.
 */
export async function registarEvento(
  entrada: {
    organizacaoId: string;
    processoId?: string | null;
    atorId?: string | null;
    acao: string;
    entidade: string;
    entidadeId?: string | null;
    valorAnterior?: Record<string, unknown> | null;
    valorNovo?: Record<string, unknown> | null;
    ip?: string | null;
    userAgent?: string | null;
  },
  executor?: unknown,
) {
  const base = (executor as ReturnType<typeof db>) ?? db();

  const [ultimo] = await base
    .select({ hash: eventoAuditoria.hash })
    .from(eventoAuditoria)
    .where(eq(eventoAuditoria.organizacaoId, entrada.organizacaoId))
    .orderBy(desc(eventoAuditoria.criadoEm), desc(eventoAuditoria.id))
    .limit(1);

  const hashAnterior = ultimo?.hash ?? null;
  const id = uuidv7();
  const criadoEm = new Date();

  const completa: EntradaAuditoria = {
    id,
    organizacaoId: entrada.organizacaoId,
    processoId: entrada.processoId ?? null,
    atorId: entrada.atorId ?? null,
    acao: entrada.acao,
    entidade: entrada.entidade,
    entidadeId: entrada.entidadeId ?? null,
    valorAnterior: entrada.valorAnterior ?? null,
    valorNovo: entrada.valorNovo ?? null,
    ip: entrada.ip ?? null,
    userAgent: entrada.userAgent ?? null,
    criadoEm,
  };

  await base.insert(eventoAuditoria).values({
    ...completa,
    hashAnterior,
    hash: calcularHash(completa, hashAnterior),
  });
}

/** Já houve leitura deste processo por este ator? Usado para não inundar o registo. */
export async function jaRegistou(processoId: string, atorId: string, acao: string) {
  const [linha] = await db()
    .select({ id: eventoAuditoria.id })
    .from(eventoAuditoria)
    .where(
      and(
        eq(eventoAuditoria.processoId, processoId),
        eq(eventoAuditoria.atorId, atorId),
        eq(eventoAuditoria.acao, acao),
      ),
    )
    .limit(1);
  return Boolean(linha);
}
