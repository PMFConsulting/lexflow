import { boolean, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { EnvelopeCifrado } from "@/lib/storage/tipos";
import { id, timestamps } from "./_comum";
import { tipoArmazenamento } from "./enums";
import { organizacao } from "./organizacao";

/**
 * Onde é que cada sociedade guarda os dossiers dos seus clientes.
 *
 * Uma linha por organização: hoje a PMF, amanhã outras sociedades, cada uma
 * com o seu OneDrive ou o seu servidor. A linha existe sempre — o que pode
 * faltar são as credenciais, e é isso que distingue "por configurar" de
 * "ligado".
 */
export const armazenamentoSociedade = pgTable(
  "armazenamento_sociedade",
  {
    id: id(),
    organizacaoId: uuid("organizacao_id")
      .notNull()
      .references(() => organizacao.id, { onDelete: "cascade" }),
    tipo: tipoArmazenamento("tipo").notNull().default("onedrive"),
    /**
     * Credenciais de ligação. A coluna é JSONB, mas o segredo nunca lá está em
     * claro: o que se grava é o criptograma AES-256-GCM, com o nonce e a
     * etiqueta de autenticação ao lado. Quem tiver leitura da base de dados
     * fica com bytes, não com o `token_refresh` do OneDrive nem com a
     * palavra-passe do servidor — a chave vive em `ARMAZENAMENTO_CHAVE`, fora
     * da base de dados, e é isso que separa "cifrado" de "codificado".
     *
     * Nulo enquanto não houver credenciais.
     */
    parametros: jsonb("parametros").$type<EnvelopeCifrado | null>(),
    /** Raiz das pastas de cliente, dentro do destino escolhido. */
    pastaRaiz: text("pasta_raiz").notNull().default("/Clientes"),
    /**
     * Interruptor da sociedade. Separado das credenciais de propósito: dá para
     * desligar a sincronização sem apagar a configuração.
     */
    ativo: boolean("ativo").notNull().default(false),
    ultimaSincronizacaoEm: timestamp("ultima_sincronizacao_em", { withTimezone: true }),
    /** Última falha, já sanitizada. Nunca contém credenciais — ver `sincronizar.ts`. */
    ultimoErro: text("ultimo_erro"),
    ...timestamps(),
  },
  (t) => [uniqueIndex("armazenamento_org").on(t.organizacaoId)],
);
