import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
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

  /* ------------------------------------------------- T&C da própria sociedade
   *
   * TODO(T&C da sociedade) — slot preparado, **por acionar**.
   *
   * Os Termos e Condições que o cliente aceita no passo 7 são, hoje, os de
   * `src/lib/termos.ts`: texto da plataforma, escrito a partir do que a lei
   * obriga a constar. Não é o que deve ficar. Quem contrata com o cliente é a
   * sociedade, e o articulado que o vincula é o dela — a plataforma é o canal,
   * não a parte.
   *
   * Estas três colunas são o espaço onde esse articulado vai viver, e existem
   * já por uma razão prática: o dia em que a sociedade entregar o documento não
   * pode ser um dia de migração com o sistema a correr. Ficam anuláveis e sem
   * leitor nenhum a depender delas — enquanto forem `null`, tudo se comporta
   * exatamente como antes.
   *
   * O que falta para acionar está escrito em `docs/TERMOS_SOCIEDADE.md`, e o
   * ponto que não se pode esquecer é o da D3/D38: os consentimentos apontam
   * para uma **versão**, e substituir o texto sem subir a versão apaga a
   * diferença entre o que o cliente aceitou e o que passou a estar escrito.
   */

  /**
   * O `documento.id` do PDF dos T&C da sociedade (tipo `termos_sociedade`), ou
   * `null` enquanto ela não o submeter.
   *
   * Sem `references()` de propósito: o documento vive pendurado num processo
   * (`documento.processo_id` é `not null`) e os T&C da sociedade não são de
   * processo nenhum. Quando o slot for acionado, ou a coluna passa a apontar
   * para uma tabela própria de documentos da sociedade, ou `processo_id` deixa
   * de ser obrigatório — as duas são decisões a tomar com o articulado à frente,
   * e nenhuma delas se toma bem hoje. Uma FK inventada agora era uma restrição
   * a defender uma forma que ainda não se sabe qual é.
   */
  termosDocumentoRef: text("termos_documento_ref"),
  /**
   * A versão do articulado da sociedade, no mesmo papel que o `VERSAO_TERMOS`
   * de `src/lib/termos.ts` tem para o texto da plataforma: é ela que fica
   * gravada junto do consentimento (D3), e é por ela que `textoEmVigor`
   * procura (D38).
   */
  termosVersao: text("termos_versao"),
  /** Quando é que a sociedade submeteu esta versão. */
  termosAtualizadoEm: timestamp("termos_atualizado_em", { withTimezone: true }),

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
