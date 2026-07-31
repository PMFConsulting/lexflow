import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id } from "./_comum";

/**
 * A peça sagrada. Append-only: nem UPDATE, nem DELETE, nem soft delete.
 *
 * A imutabilidade não é convenção de código — está garantida no Postgres por
 * REVOKE e por RULE ... DO INSTEAD NOTHING, na migração manual 0002.
 *
 * Cada linha inclui o hash da anterior, formando uma cadeia verificável por
 * `pnpm auditoria:verificar`. A cadeia é por organização: uma cadeia global
 * serializaria todas as escritas do sistema num único ponto de contenção.
 */
export const eventoAuditoria = pgTable(
  "evento_auditoria",
  {
    id: id(),
    organizacaoId: uuid("organizacao_id").notNull(),
    processoId: uuid("processo_id"),
    /** Nulo = o cliente, através do link mágico. */
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
