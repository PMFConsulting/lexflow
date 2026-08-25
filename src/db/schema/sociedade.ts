import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { extra, id, softDelete, timestamps } from "./_comum";
import {
  estadoConvite,
  estadoOnboardingSociedade,
  papelUtilizador,
  tipoDocId,
  tipoDocumentoOrganizacao,
} from "./enums";
import { organizacao, utilizador } from "./organizacao";

/**
 * The firm's own onboarding — the leg that comes before everything else.
 *
 * Until now the platform started at the point where a firm already existed:
 * the organisation came from the seeds and the accounts were written on the
 * server (D23). That is fine for one firm and stops being fine at the second —
 * and the whole shape of this product is multi-tenant since day one (see
 * `organizacao`). What was missing was the process by which a firm *becomes* a
 * row in that table, with its data, its wording and its first administrator.
 *
 * The row is born with the organisation shell, from
 * `scripts/convidar_sociedade.mjs`, and carries the same magic link mechanism
 * as the client's (D4: only the SHA-256 is stored). The firm walks the steps,
 * submits, and from that moment the organisation is `ativa` and the first
 * administrator has an invitation of their own waiting in the inbox.
 *
 * One row per organisation, and that is on purpose: re-onboarding a firm is not
 * a second row, it is editing the one that exists — otherwise "which of these
 * is the firm's data?" becomes a question with two answers.
 */
export const onboardingSociedade = pgTable(
  "onboarding_sociedade",
  {
    id: id(),
    organizacaoId: uuid("organizacao_id")
      .notNull()
      .unique()
      .references(() => organizacao.id, { onDelete: "cascade" }),
    /** SHA-256 of the magic link token. Never the token itself (D4). */
    tokenAcessoHash: text("token_acesso_hash").notNull().unique(),
    expiraEm: timestamp("expira_em", { withTimezone: true }),
    estado: estadoOnboardingSociedade("estado").notNull().default("rascunho"),
    /** Never goes backwards — same rule as the client's `passo_atual` (D58). */
    passoAtual: smallint("passo_atual").notNull().default(1),
    submetidoEm: timestamp("submetido_em", { withTimezone: true }),
    /** Who the firm named as its first administrator, at step 5. */
    adminNome: text("admin_nome"),
    adminEmail: text("admin_email"),
    adminTelefone: text("admin_telefone"),
    /** The step 6 declaration: the person submitting binds the firm. */
    declaracaoVinculo: boolean("declaracao_vinculo").notNull().default(false),
    declaracaoNome: text("declaracao_nome"),
    declaracaoCargo: text("declaracao_cargo"),
    extra: extra(),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [index("onboarding_sociedade_estado").on(t.estado)],
);

/**
 * Documents that belong to nobody's matter.
 *
 * `documento.processo_id` is `not null`, and that was the right call for what
 * that table holds — every client file hangs off a case file. The firm's T&C
 * and a lawyer's professional card hang off no case file at all, and
 * `docs/TERMOS_SOCIEDADE.md` left the choice open between "a dedicated table"
 * and "`processo_id` stops being mandatory". With the shape now in hand, the
 * dedicated table is the one that costs less: making `processo_id` nullable
 * would weaken a constraint that is correct for every existing row in order to
 * accommodate documents with a different owner, a different lifetime and a
 * different set of readers.
 *
 * Two owners, and exactly one of them per row: the organisation (the firm's
 * T&C) or an invitation (a person's identification, their bar card). The
 * organisation is always present because everything here is tenant-scoped;
 * `convite_id` is what says "this is a person's, not the firm's".
 */
export const documentoOrganizacao = pgTable(
  "documento_organizacao",
  {
    id: id(),
    organizacaoId: uuid("organizacao_id")
      .notNull()
      .references(() => organizacao.id, { onDelete: "cascade" }),
    /** Null = the firm's own document. Filled = a person's, from their onboarding. */
    conviteId: uuid("convite_id"),
    tipo: tipoDocumentoOrganizacao("tipo").notNull().default("outro"),
    nomeOriginal: text("nome_original").notNull(),
    mime: text("mime").notNull(),
    tamanhoBytes: integer("tamanho_bytes").notNull(),
    hashSha256: text("hash_sha256").notNull(),
    chaveStorage: text("chave_storage").notNull(),
    /** The file in base64, same POC compromise as `documento.dados`. */
    dados: text("dados"),
    validade: date("validade"),
    carregadoPor: uuid("carregado_por").references(() => utilizador.id, {
      onDelete: "set null",
    }),
    extra: extra(),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    index("documento_org").on(t.organizacaoId, t.tipo),
    index("documento_org_convite").on(t.conviteId),
  ],
);

/**
 * An invitation for a person to join the firm — the entry point of user
 * onboarding.
 *
 * It is the same mechanism as the client's magic link, and deliberately so: the
 * person being invited has no account yet, so there is nothing to authenticate
 * them with. What they have is an address the firm wrote to, and a token that
 * only opens their own onboarding.
 *
 * The invitation is what the onboarding data hangs off, **not** the user
 * account — the account does not exist until the last step. Keying the profile
 * to `utilizador` instead would mean creating the account up front, and an
 * account that exists before its owner finished identifying themselves is an
 * account that can log in without having done so.
 */
export const conviteUtilizador = pgTable(
  "convite_utilizador",
  {
    id: id(),
    organizacaoId: uuid("organizacao_id")
      .notNull()
      .references(() => organizacao.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    /** The name the firm typed when inviting; the person confirms it at step 1. */
    nome: text("nome").notNull(),
    papel: papelUtilizador("papel").notNull().default("advogado"),
    tokenAcessoHash: text("token_acesso_hash").notNull().unique(),
    expiraEm: timestamp("expira_em", { withTimezone: true }),
    estado: estadoConvite("estado").notNull().default("pendente"),
    passoAtual: smallint("passo_atual").notNull().default(1),
    /** Filled at the last step, when the account is finally created. */
    utilizadorId: uuid("utilizador_id").references(() => utilizador.id, {
      onDelete: "set null",
    }),
    aceiteEm: timestamp("aceite_em", { withTimezone: true }),
    /**
     * Null for the firm's first administrator: at that moment there is nobody
     * in the organisation to have sent it. Every other invitation has an author.
     */
    criadoPor: uuid("criado_por").references(() => utilizador.id, {
      onDelete: "set null",
    }),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    index("convite_org").on(t.organizacaoId, t.estado),
    index("convite_email").on(t.organizacaoId, t.email),
  ],
);

/**
 * What a person fills in during their onboarding.
 *
 * Separate from `utilizador` for the same reason `dados_identificacao` is
 * separate from `processo_onboarding`: one is the record's identity in the
 * system (role, organisation, whether it is active), the other is the data
 * collected about the person. They have different lifetimes — the account can
 * be deactivated and reactivated without the profile changing a line — and
 * different readers.
 */
export const perfilUtilizador = pgTable(
  "perfil_utilizador",
  {
    id: id(),
    organizacaoId: uuid("organizacao_id")
      .notNull()
      .references(() => organizacao.id, { onDelete: "cascade" }),
    conviteId: uuid("convite_id")
      .notNull()
      .unique()
      .references(() => conviteUtilizador.id, { onDelete: "cascade" }),
    /** Filled when the account is created, so the portal can look it up directly. */
    utilizadorId: uuid("utilizador_id").references(() => utilizador.id, {
      onDelete: "cascade",
    }),

    /* ------------------------------------------------------- step 1: identity */
    nomeCompleto: text("nome_completo"),
    dataNascimento: date("data_nascimento"),
    nif: text("nif"),
    telefone: text("telefone"),
    docTipo: tipoDocId("doc_tipo"),
    docNumero: text("doc_numero"),
    docValidade: date("doc_validade"),
    /** Address, all nullable: the row exists from step 1 and fills up gradually. */
    morada: text("morada"),
    pais: text("pais"),
    localidade: text("localidade"),
    codigoPostal: text("codigo_postal"),
    freguesia: text("freguesia"),
    concelho: text("concelho"),
    distrito: text("distrito"),

    /* --------------------------------------------------- step 2: professional */
    /**
     * The Bar Association registration number. It is what distinguishes a lawyer
     * from everybody else in the firm, and it is the number the acts are signed
     * with — an assistant does not have one, and requiring it of them would make
     * the step impossible to finish for a role that legitimately has none.
     */
    cedulaProfissional: text("cedula_profissional"),
    /** The Bar's district council (Lisboa, Porto, Coimbra…). */
    conselhoRegional: text("conselho_regional"),
    dataInscricaoOa: date("data_inscricao_oa"),
    cargo: text("cargo"),
    areasPratica: text("areas_pratica"),

    /* ------------------------------ step 4: GDPR and professional secrecy
     *
     * These are the columns a legal review asks about first, and they are
     * declarations, not preferences.
     *
     * `informacaoRgpdEm` is the timestamp at which the person was **shown** the
     * data-protection notice. It is not consent and must not be read as one:
     * the firm processes its own lawyers' data under contract and legal
     * obligation, and asking for consent where consent is not the lawful basis
     * produces a consent that is invalid and, worse, that the person believes
     * they can withdraw. What is recorded is that the information duty
     * (articles 13/14 GDPR) was discharged, and when.
     *
     * `sigiloProfissional` **is** a declaration, and a mandatory one: the
     * Estatuto da Ordem dos Advogados binds every lawyer to professional
     * secrecy, and somebody who is about to see client identification
     * documents, PEP declarations and source-of-funds statements confirms in
     * writing that they know it applies to what they will find here.
     *
     * `comunicacoesInternas` is the only one of the three that is real consent,
     * which is why it is the only one that may be `false` and still let the
     * step close.
     */
    informacaoRgpdEm: timestamp("informacao_rgpd_em", { withTimezone: true }),
    sigiloProfissional: boolean("sigilo_profissional").notNull().default(false),
    sigiloAceiteEm: timestamp("sigilo_aceite_em", { withTimezone: true }),
    comunicacoesInternas: boolean("comunicacoes_internas").notNull().default(false),

    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    index("perfil_org").on(t.organizacaoId),
    uniqueIndex("perfil_utilizador_unico").on(t.utilizadorId),
  ],
);

/**
 * A person accepting the firm's T&C — the evidence, one row per acceptance.
 *
 * This is the point the client's review asked for: the firm's wording is the
 * same from lawyer to lawyer, and every person joining has to send it back
 * accepted. `consentimento` could not hold it — its `processo_id` is `not null`
 * and points at a client matter, which this is not.
 *
 * The row is **never updated**. A new version of the wording produces a new
 * row, and the old one keeps saying what that person accepted on that day
 * (D3/D38). `versao` is copied and not referenced on purpose: it is the value
 * that was in force at that instant, and a copy cannot be edited from elsewhere.
 */
export const aceitacaoTermos = pgTable(
  "aceitacao_termos",
  {
    id: id(),
    organizacaoId: uuid("organizacao_id")
      .notNull()
      .references(() => organizacao.id, { onDelete: "cascade" }),
    conviteId: uuid("convite_id").references(() => conviteUtilizador.id, {
      onDelete: "set null",
    }),
    utilizadorId: uuid("utilizador_id").references(() => utilizador.id, {
      onDelete: "set null",
    }),
    /** The wording's version, copied at the moment of acceptance. */
    versao: text("versao").notNull(),
    /** The `documento_organizacao.id` of the file that was shown, when there is one. */
    documentoRef: text("documento_ref"),
    aceiteEm: timestamp("aceite_em", { withTimezone: true }).notNull().defaultNow(),
    ip: text("ip").notNull(),
    userAgent: text("user_agent").notNull(),
    ...timestamps(),
  },
  (t) => [
    index("aceitacao_org").on(t.organizacaoId, t.versao),
    index("aceitacao_utilizador").on(t.utilizadorId),
  ],
);
