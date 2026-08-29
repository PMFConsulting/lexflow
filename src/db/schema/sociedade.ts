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
 * Until now the platform started from an organisation already in the seeds,
 * with accounts written on the server (D23) — fine for one firm, not for the
 * second. The row is born with the organisation shell from
 * `scripts/convidar_sociedade.mjs`, using the same magic link mechanism as the
 * client's (D4, SHA-256 only).
 *
 * One row per organisation: re-onboarding is editing the row that exists, not
 * creating a second one.
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
 * `documento.processo_id` is `not null`, which is right for that table — but
 * the firm's T&C and a lawyer's bar card hang off no case file. A dedicated
 * table costs less than making `processo_id` nullable, which would weaken a
 * constraint correct for every existing row.
 *
 * Two owners, one per row: the organisation (the firm's T&C) or an invitation
 * (a person's document). `convite_id` is what distinguishes the two.
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
 * Same mechanism as the client's magic link: the invited person has no
 * account yet, only an address the firm wrote to and a token.
 *
 * The onboarding data hangs off the invitation, not the user account — the
 * account only exists from the last step, so it can't log in before its owner
 * finished identifying themselves.
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
    papel: papelUtilizador("papel").notNull().default("utilizador"),
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
 * Separate from `utilizador` for the same reason as `dados_identificacao`
 * versus `processo_onboarding`: identity in the system (role, organisation,
 * active) versus data collected about the person — different lifetimes,
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
     * Bar Association registration number — what distinguishes a lawyer from
     * the rest of the firm. An assistant legitimately has none; requiring it
     * would make the step impossible to finish for that role.
     */
    cedulaProfissional: text("cedula_profissional"),
    /** The Bar's district council (Lisboa, Porto, Coimbra…). */
    conselhoRegional: text("conselho_regional"),
    dataInscricaoOa: date("data_inscricao_oa"),
    cargo: text("cargo"),
    areasPratica: text("areas_pratica"),

    /* ------------------------------ step 4: GDPR and professional secrecy
     *
     * The three columns are not the same kind of thing. `informacaoRgpdEm` is
     * when the person was shown the notice — information, not consent: the
     * firm processes lawyers' data under contract and legal obligation, and
     * consent where it isn't the lawful basis is invalid and revocable when it
     * shouldn't be. `sigiloProfissional` is a mandatory declaration (Estatuto
     * da OA). `comunicacoesInternas` is the only real consent, hence the only
     * one allowed to stay `false`.
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
 * A person accepting the firm's T&C — evidence, one row per acceptance.
 *
 * `consentimento` couldn't hold this: its `processo_id` is `not null` and
 * points at a client matter, which this isn't.
 *
 * Never updated. A new wording version produces a new row, and the old one
 * keeps saying what that person accepted on that day (D3/D38). `versao` is
 * copied rather than referenced — a copy can't be edited from elsewhere.
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
