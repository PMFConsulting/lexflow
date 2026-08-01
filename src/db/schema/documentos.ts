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
 * Ficheiros carregados. A chave de storage aponta sempre para bucket privado —
 * nenhum documento de identificação é acessível por URL público, e todo o
 * download passa por URL assinado de curta duração e fica em auditoria.
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
    /** Alimenta os alertas de validade do painel. */
    validade: date("validade"),
    /** Nulo = carregado pelo cliente através do link mágico. */
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
 * Assinatura do passo 7. Fora do âmbito da POC (o formulário atual não tem
 * assinatura nenhuma), mas o modelo segue o vocabulário do Documenso para que
 * trocar por DocuSeal, Documenso ou um QTSP seja adaptador e não migração.
 */
export const assinatura = pgTable("assinatura", {
  id: id(),
  processoId: uuid("processo_id")
    .notNull()
    .unique()
    .references(() => processoOnboarding.id, { onDelete: "restrict" }),
  tipo: text("tipo").notNull().default("simples"),
  /** Rubrica em storage privado, quando houver storage configurado. */
  imagemChave: text("imagem_chave"),
  /**
   * A rubrica em PNG base64, enquanto não há object storage.
   *
   * Compromisso assumido da POC: o certo é a imagem viver num bucket privado e
   * aqui ficar só a chave. Fica registado para não passar despercebido — são
   * alguns kilobytes por processo, o que aguenta uma POC e não aguenta escala.
   */
  imagemDados: text("imagem_dados"),
  /** SHA-256 do PDF final do dossier. */
  hashDocumento: text("hash_documento").notNull(),
  documentoId: uuid("documento_id").references(() => documento.id, {
    onDelete: "restrict",
  }),
  ip: text("ip").notNull(),
  userAgent: text("user_agent").notNull(),
  /** Relógio do servidor, nunca o do cliente. */
  assinadoEm: timestamp("assinado_em", { withTimezone: true }).notNull(),
  metadados: jsonb("metadados").$type<Record<string, unknown>>().default({}),
  ...timestamps(),
});
