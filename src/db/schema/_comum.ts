import { customType, jsonb, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";

/**
 * Colunas partilhadas. São funções, não constantes: cada tabela precisa da sua
 * própria instância do construtor de coluna.
 */

/** UUID v7 — ordenável por tempo, o que dá localidade de índice e cursores estáveis. */
export const id = () =>
  uuid("id")
    .primaryKey()
    .$defaultFn(() => uuidv7());

export const timestamps = () => ({
  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/**
 * Soft delete. Só nas tabelas com retenção legal: esconder da aplicação não é
 * apagar, e a Lei 83/2017 obriga a conservar 7 anos.
 */
export const softDelete = () => ({
  apagadoEm: timestamp("apagado_em", { withTimezone: true }),
});

/**
 * Escape hatch para o que é genuinamente variável. Não é sítio para o que se
 * pesquisa, filtra ou indexa — isso é coluna.
 */
export const extra = () => jsonb("extra").$type<Record<string, unknown>>().default({});

/** Postgres tsvector. Mantida por trigger — ver a migração manual 0001. */
export const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => "tsvector",
});

/**
 * Bloco de morada: sete campos, exatamente como o formulário real
 * (docs/CAMPOS.md). Repete-se em cliente, representante e faturação; é sempre
 * 1:1 e nunca se pesquisa por ela isoladamente, por isso não é tabela.
 */
export const morada = () => ({
  morada: text("morada").notNull(),
  pais: text("pais").notNull(),
  localidade: text("localidade").notNull(),
  codigoPostal: text("codigo_postal").notNull(),
  freguesia: text("freguesia").notNull(),
  concelho: text("concelho").notNull(),
  distrito: text("distrito").notNull(),
});
