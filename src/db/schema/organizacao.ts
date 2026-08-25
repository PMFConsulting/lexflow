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

  /* ------------------------------------------------ Firm identity and contacts
   *
   * All nullable, and all filled in by the firm's own onboarding
   * (`onboarding_sociedade`). Nullable is not laziness: the organisation row is
   * born as a shell the moment the firm is invited, and it stays a shell until
   * somebody on their side walks the steps. Making these `not null` would force
   * inventing values at creation time — and an invented address is worse than
   * an absent one, because it looks like an answer.
   *
   * The seeded organisation predates all of this and has none of them; it keeps
   * working exactly as before, which is the test of whether the addition really
   * was additive.
   */
  /** Legal form: 'Sociedade de Advogados, SP, RL', 'Advogado em prática individual'… */
  naturezaJuridica: text("natureza_juridica"),
  /** The firm's registration number with the Bar Association. */
  numeroOrdem: text("numero_ordem"),
  emailGeral: text("email_geral"),
  telefone: text("telefone"),
  website: text("website"),
  morada: text("morada"),
  pais: text("pais"),
  localidade: text("localidade"),
  codigoPostal: text("codigo_postal"),
  freguesia: text("freguesia"),
  concelho: text("concelho"),
  distrito: text("distrito"),

  /* ------------------------------------------------- T&C da própria sociedade
   *
   * **Acionado.** O que aqui esteve escrito durante a revisão de 23/08 — «slot
   * preparado, por acionar» — deixou de ser verdade: a sociedade entrega o
   * articulado no seu próprio onboarding, cada pessoa que se junta à sociedade
   * aceita-o no dela, e o passo 7 do cliente serve este documento em vez do
   * texto da plataforma sempre que ele exista. O plano está em
   * `docs/TERMOS_SOCIEDADE.md`, agora como registo do que foi feito.
   *
   * O problema que resolvem continua o mesmo: quem contrata com o cliente é a
   * sociedade, e o articulado que o vincula é o dela — a plataforma é o canal,
   * não a parte. Enquanto forem `null`, o passo 7 serve `src/lib/termos.ts` e o
   * cliente não tem de fazer nada de novo; a preparação foi feita com essa
   * propriedade e é ela que permite que a instalação existente não note a
   * diferença.
   *
   * O ponto que não se pode esquecer é o da D3/D38: os consentimentos apontam
   * para uma **versão**, e substituir o documento sem subir a versão apaga a
   * diferença entre o que o cliente aceitou e o que passou a estar escrito. É
   * por isso que a versão é pedida no ecrã de submissão e recusada quando é
   * igual à que está em vigor — não é validação por gosto, é o que impede o
   * apagamento silencioso da prova.
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
