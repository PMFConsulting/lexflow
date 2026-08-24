import { boolean, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { EnvelopeCifrado } from "@/lib/storage/tipos";
import { id, timestamps } from "./_comum";
import { organizacao } from "./organizacao";

/**
 * Where each firm keeps its clients' case files.
 *
 * One row per organisation: today JMASSANO, tomorrow other firms, each with
 * their own server. The row always exists — what may be missing are the
 * credentials, and that is what distinguishes "to be configured" from
 * "connected".
 *
 * There is no type column: the destination is always the firm's dedicated
 * server, over SFTP. The choice between destinations existed while OneDrive was
 * on the table, and left with it.
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
