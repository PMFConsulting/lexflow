import { boolean, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { EnvelopeCifrado } from "@/lib/storage/tipos";
import { id, timestamps } from "./_comum";
import { organizacao } from "./organizacao";

/**
 * Where each firm keeps its clients' case files.
 *
 * One row per organisation: today one firm, tomorrow others, each with
 * their own server. The row always exists — what may be missing are the
 * credentials, and that is what distinguishes "to be configured" from
 * "connected".
 *
 * The destination is the firm's dedicated server over SFTP, unless
 * `bucketS3` is filled in — an S3 bucket dedicated to that society, never
 * shared. A null `bucketS3` is what keeps every row written before S3 existed
 * reading exactly as it did.
 */
export const armazenamentoSociedade = pgTable(
  "armazenamento_sociedade",
  {
    id: id(),
    organizacaoId: uuid("organizacao_id")
      .notNull()
      .references(() => organizacao.id, { onDelete: "cascade" }),
    /**
     * Connection credentials. The column is JSONB, but the secret is never
     * there in the clear: what gets stored is the AES-256-GCM ciphertext, with
     * the nonce and the authentication tag alongside. Whoever has read access
     * to the database ends up with bytes, not with the server's password — the
     * key lives in `ARMAZENAMENTO_CHAVE`, outside the database, and that is
     * what separates "encrypted" from "encoded".
     *
     * Null while there are no credentials.
     */
    parametros: jsonb("parametros").$type<EnvelopeCifrado | null>(),
    /** Root of the client folders, inside the chosen destination. */
    pastaRaiz: text("pasta_raiz").notNull().default("/Clientes"),
    /**
     * The society's dedicated S3 bucket name, e.g. `lexflow-jmassano`. Null
     * means the destination is SFTP, as before S3 existed — this column, not
     * a type enum, is what `sincronizar.ts` reads to choose. Not secret: the
     * bucket name carries no credential, unlike `parametros`.
     */
    bucketS3: text("bucket_s3"),
    /**
     * The firm's switch. Kept separate from the credentials on purpose: it
     * allows switching the sync off without deleting the configuration.
     */
    ativo: boolean("ativo").notNull().default(false),
    ultimaSincronizacaoEm: timestamp("ultima_sincronizacao_em", { withTimezone: true }),
    /** Last failure, already sanitised. Never contains credentials — see `sincronizar.ts`. */
    ultimoErro: text("ultimo_erro"),
    ...timestamps(),
  },
  (t) => [uniqueIndex("armazenamento_org").on(t.organizacaoId)],
);
