import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id } from "./_comum";

/**
 * The sacred piece. Append-only: no UPDATE, no DELETE, no soft delete.
 *
 * Immutability is not a code convention — it is guaranteed in Postgres by
 * REVOKE and by RULE ... DO INSTEAD NOTHING, in the manual migration 0002.
 *
 * Each row includes the previous one's hash, forming a chain verifiable by
 * `pnpm auditoria:verificar`. The chain is per organisation: a global chain
 * would serialise every write in the system through a single point of
 * contention.
 */
export const eventoAuditoria = pgTable(
  "evento_auditoria",
  {
    id: id(),
    organizacaoId: uuid("organizacao_id").notNull(),
    processoId: uuid("processo_id"),
    /** Null = the client, through the magic link. */
    atorId: uuid("ator_id"),
    /** 'processo.aprovado', 'documento.descarregado', 'ppe.consultado'… */
    acao: text("acao").notNull(),
    entidade: text("entidade").notNull(),
    entidadeId: uuid("entidade_id"),
    valorAnterior: jsonb("valor_anterior").$type<Record<string, unknown> | null>(),
    valorNovo: jsonb("valor_novo").$type<Record<string, unknown> | null>(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    hashAnterior: text("hash_anterior"),
    hash: text("hash").notNull(),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("auditoria_org").on(t.organizacaoId, t.criadoEm),
    index("auditoria_processo").on(t.processoId, t.criadoEm),
    index("auditoria_ator").on(t.atorId, t.criadoEm),
    index("auditoria_acao").on(t.acao),
  ],
);
