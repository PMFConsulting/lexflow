import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, softDelete, timestamps } from "./_comum";
import { papelUtilizador } from "./enums";

/** Multi-tenant desde o dia 1: hoje a PMF, amanhã outras sociedades. */
export const organizacao = pgTable("organizacao", {
  id: id(),
  nome: text("nome").notNull(),
  nif: text("nif").notNull(),
  /** Prefixo da referência de processo: 'PMF' → PMF-2026-0142. */
  prefixoReferencia: text("prefixo_referencia").notNull(),
  ...timestamps(),
  ...softDelete(),
});

/**
 * Tabela de domínio, deliberadamente separada das tabelas do Better Auth
 * (`user`, `session`, `account`). Ligadas por `authUserId`.
 *
 * Misturar as duas transforma qualquer atualização da biblioteca numa migração
 * de dados de negócio — decisão D2 em CLAUDE.md.
 */
export const utilizador = pgTable(
  "utilizador",
  {
    id: id(),
    organizacaoId: uuid("organizacao_id")
      .notNull()
      .references(() => organizacao.id, { onDelete: "restrict" }),
    authUserId: text("auth_user_id").unique(),
    nome: text("nome").notNull(),
    email: text("email").notNull(),
    papel: papelUtilizador("papel").notNull().default("assistente"),
    ativo: boolean("ativo").notNull().default(true),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    uniqueIndex("utilizador_email_org").on(t.organizacaoId, t.email),
    index("utilizador_org").on(t.organizacaoId),
  ],
);

/**
 * Contador de referências, por organização e ano. Um `SELECT max()+1` dá
 * duplicados no primeiro dia com dois utilizadores em simultâneo; isto
 * resolve-se com `UPDATE ... RETURNING`, que é atómico.
 */
export const contadorReferencia = pgTable(
  "contador_referencia",
  {
    id: id(),
    organizacaoId: uuid("organizacao_id")
      .notNull()
      .references(() => organizacao.id, { onDelete: "cascade" }),
    ano: integer("ano").notNull(),
    ultimo: integer("ultimo").notNull().default(0),
    ...timestamps(),
  },
  (t) => [uniqueIndex("contador_org_ano").on(t.organizacaoId, t.ano)],
);
