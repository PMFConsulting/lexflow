import {
  boolean,
  date,
  index,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { extra, id, morada, timestamps } from "./_comum";
import { origemContacto, regimeIva, tipoDocId, titularNacionalidade } from "./enums";
import { processoOnboarding } from "./processo";

/**
 * Uma tabela por secção, 1:1 com o processo. Os campos que só existem num dos
 * percursos (particular / empresa) são anuláveis na base de dados e obrigatórios
 * no schema Zod do passo — a condicionalidade é regra de negócio, não de coluna.
 */

const processoId = () =>
  uuid("processo_id")
    .notNull()
    .references(() => processoOnboarding.id, { onDelete: "cascade" });

/* ------------------------------------------------------------------ passo 1 */

export const dadosIdentificacao = pgTable(
  "dados_identificacao",
  {
    id: id(),
    processoId: processoId().unique(),
    /** Nome completo (particular) ou denominação social (empresa). */
    nome: text("nome").notNull(),
    /* --- só particular --- */
    profissao: text("profissao"),
    /** "N/A" quando não se aplica — é o que o formulário atual instrui. */
    entidadePatronal: text("entidade_patronal"),
    dataNascimento: date("data_nascimento"),
    /* --- só empresa (por validar contra imagem, A18) --- */
    naturezaJuridica: text("natureza_juridica"),
    dataConstituicao: date("data_constituicao"),
    /* --- ambos --- */
    telefone: text("telefone").notNull(),
    email: text("email").notNull(),
    ...morada(),
    extra: extra(),
    ...timestamps(),
  },
  (t) => [index("identificacao_nome").on(t.nome)],
);

/** Multi-valor no formulário real: chips, não um select único. */
export const nacionalidade = pgTable(
  "nacionalidade",
  {
    id: id(),
    processoId: processoId(),
    titular: titularNacionalidade("titular").notNull(),
    pais: text("pais").notNull(),
    ...timestamps(),
  },
  (t) => [uniqueIndex("nacionalidade_unica").on(t.processoId, t.titular, t.pais)],
);

/* ------------------------------------------------------------------ passo 2 */

export const dadosFiscais = pgTable(
  "dados_fiscais",
  {
    id: id(),
    processoId: processoId().unique(),
    nifPortugues: boolean("nif_portugues").notNull().default(true),
    resideEmPortugal: boolean("reside_em_portugal").notNull().default(true),
    /** Validado por mod-11 apenas quando `nifPortugues`. */
    nif: text("nif").notNull(),
    /** O documento de identificação vive aqui, não no passo 1 — divergência D3. */
    docTipo: tipoDocId("doc_tipo").notNull(),
    docNumero: text("doc_numero").notNull(),
    docValidade: date("doc_validade").notNull(),
    /* --- só empresa (por validar, A18) --- */
    cae: text("cae"),
    codigoCertidaoPermanente: text("codigo_certidao_permanente"),
    regimeIva: regimeIva("regime_iva"),
    extra: extra(),
    ...timestamps(),
  },
  (t) => [
    index("fiscais_nif").on(t.nif),
    // alimenta o alerta de documentos a expirar nos próximos 60 dias (§6)
    index("fiscais_doc_validade").on(t.docValidade),
  ],
);

/** CRS/FATCA. Sem UI na POC; o schema fica pronto. */
export const residenciaFiscalAdicional = pgTable(
  "residencia_fiscal_adicional",
  {
    id: id(),
    processoId: processoId(),
    jurisdicao: text("jurisdicao").notNull(),
    tin: text("tin").notNull(),
    ...timestamps(),
  },
  (t) => [uniqueIndex("residencia_unica").on(t.processoId, t.jurisdicao)],
);

/* ------------------------------------------------------------------ passo 3 */

export const representanteLegal = pgTable(
  "representante_legal",
  {
    id: id(),
    processoId: processoId().unique(),
    /** Interruptor do topo do passo: "É representante?" */
    eRepresentante: boolean("e_representante").notNull().default(false),
    relacao: text("relacao"),
    nome: text("nome"),
    dataNascimento: date("data_nascimento"),
    profissao: text("profissao"),
    telefone: text("telefone"),
    email: text("email"),
    morada: text("morada"),
    pais: text("pais"),
    localidade: text("localidade"),
    codigoPostal: text("codigo_postal"),
    freguesia: text("freguesia"),
    concelho: text("concelho"),
    distrito: text("distrito"),
    nif: text("nif"),
    docTipo: tipoDocId("doc_tipo"),
    docNumero: text("doc_numero"),
    docValidade: date("doc_validade"),
    /** Percurso Empresa. Sem UI na POC (A19). */
    codigoRcbe: text("codigo_rcbe"),
    ambitoPoderes: text("ambito_poderes"),
    extra: extra(),
    ...timestamps(),
  },
  (t) => [index("representante_nif").on(t.nif)],
);

/**
 * Beneficiários efetivos. Não existem no formulário atual (divergência D7) mas
 * são obrigação de identificação em KYC — schema criado, UI adiada (A19).
 */
export const beneficiarioEfetivo = pgTable(
  "beneficiario_efetivo",
  {
    id: id(),
    processoId: processoId(),
    nome: text("nome").notNull(),
    nif: text("nif"),
    percentagem: numeric("percentagem", { precision: 5, scale: 2 }),
    naturezaControlo: text("natureza_controlo"),
    ...timestamps(),
  },
  (t) => [index("beneficiario_processo").on(t.processoId), index("beneficiario_nif").on(t.nif)],
);

/* ------------------------------------------------------------------ passo 4 */

/** Dados especialmente sensíveis: invisíveis ao papel `assistente`. */
export const declaracaoPpe = pgTable("declaracao_ppe", {
  id: id(),
  processoId: processoId().unique(),
  /** "Ocupa ou ocupou nos últimos 12 meses algum cargo público ou político…" */
  ePpe: boolean("e_ppe").notNull(),
  ppeCargo: text("ppe_cargo"),
  ppePais: text("ppe_pais"),
  ppeEntidade: text("ppe_entidade"),
  ppeInicio: date("ppe_inicio"),
  /** Nulo = ainda em exercício. */
  ppeFim: date("ppe_fim"),
  /** "É membro próximo da família ou … estreitamente associado com uma PPE?" */
  eRelacionadoPpe: boolean("e_relacionado_ppe").notNull(),
  relacaoPpe: text("relacao_ppe"),
  ppeRelacionadaNome: text("ppe_relacionada_nome"),
  ppeRelacionadaCargo: text("ppe_relacionada_cargo"),
  ppeRelacionadaPais: text("ppe_relacionada_pais"),
  extra: extra(),
  ...timestamps(),
});

/** Também no passo 4, mas é outra coisa: relação de negócio, não declaração. */
export const relacaoNegocio = pgTable("relacao_negocio", {
  id: id(),
  processoId: processoId().unique(),
  /** "Serviço(s) jurídico(s) que lhe vamos prestar" — declarado pelo cliente. */
  servicos: text("servicos").notNull(),
  /** Obrigatória sempre, não só para PPE — o formulário já está certo (D5). */
  origemFundos: text("origem_fundos").notNull(),
  extra: extra(),
  ...timestamps(),
});

/* ------------------------------------------------------------------ passo 5 */

export const preferenciasContacto = pgTable("preferencias_contacto", {
  id: id(),
  processoId: processoId().unique(),
  origemContacto: origemContacto("origem_contacto"),
  /** "Quem?" — condicional a `recomendacao`. */
  origemDetalhe: text("origem_detalhe"),
  newsletter: boolean("newsletter").notNull().default(false),
  convitesIniciativas: boolean("convites_iniciativas").notNull().default(false),
  convitesNome: text("convites_nome"),
  convitesEmail: text("convites_email"),
  extra: extra(),
  ...timestamps(),
});

export const emailNewsletter = pgTable(
  "email_newsletter",
  {
    id: id(),
    processoId: processoId(),
    email: text("email").notNull(),
    ...timestamps(),
  },
  (t) => [uniqueIndex("newsletter_email_unico").on(t.processoId, t.email)],
);

export const areaInteresse = pgTable(
  "area_interesse",
  {
    id: id(),
    processoId: processoId(),
    area: text("area").notNull(),
    ...timestamps(),
  },
  (t) => [uniqueIndex("area_unica").on(t.processoId, t.area)],
);

/* ------------------------------------------------------------------ passo 6 */

export const dadosFaturacao = pgTable("dados_faturacao", {
  id: id(),
  processoId: processoId().unique(),
  igualAoCliente: boolean("igual_ao_cliente").notNull().default(false),
  nome: text("nome").notNull(),
  nif: text("nif").notNull(),
  ...morada(),
  email: text("email").notNull(),
  /* --- bloco "Ao cuidado de" --- */
  acIgualAoCliente: boolean("ac_igual_ao_cliente").notNull().default(false),
  acNome: text("ac_nome"),
  acEmail: text("ac_email"),
  acTelefone: text("ac_telefone"),
  /**
   * Não existem no formulário atual (divergência D4). Colunas criadas para o dia
   * em que existirem; sem UI na POC.
   */
  iban: text("iban"),
  condicoesPagamento: text("condicoes_pagamento"),
  periodicidade: text("periodicidade"),
  referenciaCliente: text("referencia_cliente"),
  extra: extra(),
  ...timestamps(),
});

/* ------------------------------------------------------------------ passo 7 */

export const fechoProposta = pgTable("fecho_proposta", {
  id: id(),
  processoId: processoId().unique(),
  /** O único campo que o passo 7 tinha — divergência D1, agora coberta. */
  declaracaoVeracidade: boolean("declaracao_veracidade").notNull().default(false),
  /** Aceitação explícita dos T&C e da proposta — a parte do passo 7 do brief que faltava. */
  tcAceitacao: boolean("tc_aceitacao").notNull().default(false),
  /* --- para o dia em que o passo 7 do brief avançar --- */
  servicosContratados: text("servicos_contratados"),
  modeloHonorarios: text("modelo_honorarios"),
  valor: numeric("valor", { precision: 12, scale: 2 }),
  moeda: text("moeda").default("EUR"),
  extra: extra(),
  ...timestamps(),
});
