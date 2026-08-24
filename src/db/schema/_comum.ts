import { customType, jsonb, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";

/**
 * Shared columns. They are functions, not constants: each table needs its own
 * instance of the column builder.
 */

/** UUID v7 — time-orderable, which gives index locality and stable cursors. */
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
 * Soft delete. Only on tables with legal retention: hiding from the application
 * is not deleting, and Lei 83/2017 requires 7 years of retention.
 */
export const softDelete = () => ({
  apagadoEm: timestamp("apagado_em", { withTimezone: true }),
});

/**
 * Escape hatch for what is genuinely variable. Not the place for what gets
 * searched, filtered or indexed — that is a column.
 */
export const extra = () => jsonb("extra").$type<Record<string, unknown>>().default({});

/** Postgres tsvector. Maintained by trigger — see the manual migration 0001. */
export const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => "tsvector",
});

/**
 * Address block: seven fields, exactly as in the real form (docs/CAMPOS.md). It
 * repeats in client, representative and billing; it is always 1:1 and is never
 * searched on its own, so it is not a table.
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
