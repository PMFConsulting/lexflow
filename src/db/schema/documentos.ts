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
     * Deprecated (D66). While the firm's bucket is active, `carregarDocumento`
     * never fills this in — the file goes straight to S3 and `chaveStorage` is
     * the only pointer that exists. It stays here, nullable, for two reasons
     * only: the 215+ existing matters uploaded before this change, still
     * carrying their file here (migration prepared in
     * `scripts/migrar-documentos-s3.ts`, deliberately not run yet), and a
     * firm still on SFTP, which has no per-document reader — see
     * `destinoDaOrganizacao`. `dados !== null` is exactly how the download
     * route and `sincronizar.ts` tell "legacy, read from here" from "current,
     * read from the bucket".
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
