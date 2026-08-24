import {
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { extra, id, softDelete, timestamps } from "./_comum";
import { tipoDocumento } from "./enums";
import { processoOnboarding } from "./processo";
import { utilizador } from "./organizacao";

/**
 * Uploaded files. The storage key always points at a private bucket — no
 * identification document is reachable by a public URL, and every download goes
 * through a short-lived signed URL and is recorded in the audit trail.
 */
export const documento = pgTable(
  "documento",
  {
    id: id(),
    processoId: uuid("processo_id")
      .notNull()
      .references(() => processoOnboarding.id, { onDelete: "cascade" }),
    tipo: tipoDocumento("tipo").notNull().default("outro"),
    nomeOriginal: text("nome_original").notNull(),
    mime: text("mime").notNull(),
    tamanhoBytes: integer("tamanho_bytes").notNull(),
    hashSha256: text("hash_sha256").notNull(),
    chaveStorage: text("chave_storage").notNull(),
    /**
     * The file in base64, while there is no object storage.
     *
     * The same compromise as the signature, and for the same reason: the right
     * answer is a private bucket with the key here. Base64 adds 33% to the
     * size, hence the 4 MB per-file limit. It holds up for a POC; it does not
     * hold up for an archive.
     */
    dados: text("dados"),
    /** Feeds the dashboard's expiry alerts. */
    validade: date("validade"),
    /** Null = uploaded by the client through the magic link. */
    carregadoPor: uuid("carregado_por").references(() => utilizador.id, {
      onDelete: "set null",
    }),
    extra: extra(),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    index("documento_processo").on(t.processoId),
    index("documento_validade").on(t.validade),
  ],
);

/**
 * The step 7 signature. Outside the POC's scope (the current form has no
 * signature at all), but the model follows Documenso's vocabulary so that
 * swapping in DocuSeal, Documenso or a QTSP is an adapter and not a migration.
 */
export const assinatura = pgTable("assinatura", {
  id: id(),
  processoId: uuid("processo_id")
    .notNull()
    .unique()
    .references(() => processoOnboarding.id, { onDelete: "restrict" }),
  tipo: text("tipo").notNull().default("simples"),
  /** Signature in private storage, once storage is configured. */
  imagemChave: text("imagem_chave"),
  /**
   * The signature as base64 PNG, while there is no object storage.
   *
   * A POC compromise taken knowingly: the right answer is for the image to live
   * in a private bucket and only the key to stay here. It is recorded so it
   * does not slip by unnoticed — it is a few kilobytes per matter, which holds
   * up for a POC and does not hold up at scale.
   */
  imagemDados: text("imagem_dados"),
  /** SHA-256 of the case file's final PDF. */
  hashDocumento: text("hash_documento").notNull(),
  documentoId: uuid("documento_id").references(() => documento.id, {
    onDelete: "restrict",
  }),
  ip: text("ip").notNull(),
  userAgent: text("user_agent").notNull(),
  /** The server's clock, never the client's. */
  assinadoEm: timestamp("assinado_em", { withTimezone: true }).notNull(),
  metadados: jsonb("metadados").$type<Record<string, unknown>>().default({}),
  ...timestamps(),
});
