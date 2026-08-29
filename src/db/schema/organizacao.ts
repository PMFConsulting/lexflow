import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { id, softDelete, timestamps } from "./_comum";
import { papelUtilizador } from "./enums";

/**
 * Multi-tenant desde o dia 1. Até à 0016, a única sociedade nascia de uma
 * seed; agora nasce no portal do super_admin — daí as duas restrições de
 * unicidade abaixo, que antes nada tinha como violar.
 */
export const organizacao = pgTable(
  "organizacao",
  {
    id: id(),
    nome: text("nome").notNull(),
    nif: text("nif").notNull(),
    /** Prefixo da referência de processo: 'PMF' → PMF-2026-0142. */
    prefixoReferencia: text("prefixo_referencia").notNull(),

  /* ------------------------------------------ Identidade e contactos da sociedade
   *
   * Todas anuláveis, preenchidas pelo próprio onboarding da sociedade
   * (`onboarding_sociedade`). A organização nasce como shell ao ser convidada
   * e fica assim até alguém do outro lado percorrer os passos — inventar
   * valores obrigatórios seria pior do que deixá-los ausentes.
   */
  /** Forma jurídica: 'Sociedade de Advogados, SP, RL', 'Advogado em prática individual'… */
  naturezaJuridica: text("natureza_juridica"),
  /** Número de registo da sociedade na Ordem dos Advogados. */
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
   * Acionado (D59): a sociedade entrega o seu articulado no próprio
   * onboarding, e o passo 7 do cliente serve este documento em vez do texto
   * da plataforma sempre que exista. Enquanto `null`, serve `lib/termos.ts` —
   * é essa propriedade que torna a instalação existente insensível à mudança.
   *
   * Versão pedida e recusada quando igual à vigente (D3/D38): sem isso, trocar
   * o documento sem subir a versão apaga a diferença entre o que o cliente
   * aceitou e o que passou a estar escrito.
   */

    /**
     * `documento.id` do PDF dos T&C da sociedade (tipo `termos_sociedade`), ou
     * `null` até ela o submeter. Sem `references()` de propósito: o documento
     * vive pendurado num processo (`documento.processo_id` é `not null`) e os
     * T&C da sociedade não são de processo nenhum.
     */
    termosDocumentoRef: text("termos_documento_ref"),
    /** Versão do articulado da sociedade — gravada junto do consentimento (D3), procurada por `textoEmVigor` (D38). */
    termosVersao: text("termos_versao"),
    /** Quando é que a sociedade submeteu esta versão. */
    termosAtualizadoEm: timestamp("termos_atualizado_em", { withTimezone: true }),

    /* ------------------------------------------- Email do domínio da sociedade
     *
     * Antes, os quatro canais partilhavam um remetente só (EMAIL_REMETENTE).
     * Com duas sociedades, o cliente da segunda receberia pedidos de dados
     * pessoais assinados com o domínio da primeira. Colunas anuláveis: ausência
     * significa "ainda usa o remetente global" — adição puramente aditiva.
     */

    /**
     * Endereço `From` desta sociedade (`geral@andradecosta.pt`). Guardado
     * mesmo antes de o domínio estar verificado — o preço de o usar cedo é um
     * 403 da Resend com o remetente à frente, resolvido à primeira leitura (D43).
     */
    emailRemetente: text("email_remetente"),
    /** Domínio de envio, sem a parte local — separado do remetente porque um endereço pode mudar sem refazer SPF/DKIM. */
    dominioEmail: text("dominio_email"),
    /** `id` do domínio na Resend — sem ele não há a quem perguntar o estado. */
    dominioResendId: text("dominio_resend_id"),
    /** Quando a Resend disse `verified` pela primeira vez. */
    dominioVerificadoEm: timestamp("dominio_verificado_em", { withTimezone: true }),
    /**
     * Espelho do `status` da Resend (`not_started`, `pending`, `verified`,
     * `failed`…). `text` e não enum: o conjunto de valores é de outra pessoa e
     * um enum obrigaria a migração sempre que a Resend acrescentasse um estado.
     */
    dominioEstado: text("dominio_estado"),

    /* ------------------------------------------- Logótipo próprio da sociedade
     *
     * Cada sociedade pode usar a sua marca no portal em vez do logótipo
     * genérico. Guardado em base64 com mime e nome originais (POC). Colunas
     * anuláveis: `null` usa o logótipo padrão do software.
     */
    logotipoDados: text("logotipo_dados"),
    logotipoMime: text("logotipo_mime"),
    logotipoNome: text("logotipo_nome"),
    logotipoAtualizadoEm: timestamp("logotipo_atualizado_em", { withTimezone: true }),

    /**
     * Preferência da sociedade para receber um email de aviso a cada novo processo
     * submetido (template notificacao_backoffice). Por omissão é false (0 emails;
     * substituído por notificação in-app).
     */
    notificarSubmissoesEmail: boolean("notificar_submissoes_email").notNull().default(false),

    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    // Prefixo separa visualmente os dossiers de duas sociedades
    // (PMF-2026-0142) — duas com o mesmo prefixo pareceriam da mesma casa.
    // Índice parcial: sociedade apagada não reserva o prefixo para sempre.
    uniqueIndex("organizacao_prefixo")
      .on(t.prefixoReferencia)
      .where(sql`${t.apagadoEm} is null`),
    uniqueIndex("organizacao_nif").on(t.nif).where(sql`${t.apagadoEm} is null`),
  ],
);

/**
 * Tabela de domínio, separada de propósito das tabelas do Better Auth (`user`,
 * `session`, `account`), ligadas por `authUserId` — misturar as duas
 * transformaria uma atualização da biblioteca numa migração de dados (D2).
 */
export const utilizador = pgTable(
  "utilizador",
  {
    id: id(),
    /**
     * Sociedade a que pertence — anulável desde a 0016. `NULL` significa só
     * uma coisa: `super_admin`, dono da plataforma (garantido pelo check
     * `utilizador_org_por_papel` abaixo). Isolamento automático: toda consulta
     * compara `organizacao_id` com a de quem lê, e `NULL = x` nunca é verdadeiro.
     */
    organizacaoId: uuid("organizacao_id").references(() => organizacao.id, {
      onDelete: "restrict",
    }),
    authUserId: text("auth_user_id"),
    nome: text("nome").notNull(),
    email: text("email").notNull(),
    /** `utilizador` por omissão — o papel que menos pode é o que se dá a quem chega sem se dizer nada. */
    papel: papelUtilizador("papel").notNull().default("utilizador"),
    /**
     * Gestor a quem esta pessoa está associada — só para o papel `utilizador`
     * (garantido por `utilizador_gestor_papel` abaixo). `AnyPgColumn` é o tipo
     * que o Drizzle exige numa auto-referência, não um `any`.
     * `on delete set null`: um gestor que sai não leva consigo as contas que coordenava.
     */
    gestorId: uuid("gestor_id").references((): AnyPgColumn => utilizador.id, {
      onDelete: "set null",
    }),
    /**
     * Data em que a conta foi aprovada pelo super_admin da plataforma.
     * NULL = pendente de aprovação; preenchido = aprovado.
     */
    aprovadoEm: timestamp("aprovado_em", { withTimezone: true }),
    ativo: boolean("ativo").notNull().default(true),
    /**
     * Obriga a definir palavra-passe nova antes de usar a plataforma — uma
     * conta criada por admin nasce com uma gerada e enviada por email, um
     * segredo que já viajou por canal não secreto. Enquanto `true`,
     * `exigirSessao()` prende a pessoa em `/definir-palavra-passe`.
     *
     * Vive aqui e não em `user` — a tabela do Better Auth não leva colunas de
     * negócio (D2). Omissão `false` de propósito: um default `true` obrigaria
     * todas as contas existentes a redefinir no login seguinte.
     */
    deveRedefinirPassword: boolean("deve_redefinir_password").notNull().default(false),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    uniqueIndex("utilizador_email_org").on(t.organizacaoId, t.email),
    // O índice de cima não cobre super_admin: dois NULL não colidem num
    // índice único no Postgres, e duas linhas de plataforma com o mesmo email
    // dariam duas resoluções possíveis para a mesma conta. Este índice parcial fecha essa porta.
    uniqueIndex("utilizador_email_plataforma")
      .on(t.email)
      .where(sql`${t.organizacaoId} is null`),
    /** Unicidade de auth_user_id por organização (0025): a mesma conta Better Auth pode administrar várias sociedades sem colidir globalmente. */
    uniqueIndex("utilizador_auth_org").on(t.organizacaoId, t.authUserId),
    uniqueIndex("utilizador_auth_plataforma")
      .on(t.authUserId)
      .where(sql`${t.organizacaoId} is null`),
    index("utilizador_org").on(t.organizacaoId),
    index("utilizador_gestor_id_idx").on(t.gestorId),
    // Regra também aplicada no Server Action (mensagem em português), mas o
    // check protege os outros caminhos — script, UPDATE à mão, seed — onde
    // não há ninguém para ler essa mensagem.
    check(
      "utilizador_org_por_papel",
      sql`(${t.papel} = 'super_admin' and ${t.organizacaoId} is null)
          or (${t.papel} <> 'super_admin' and ${t.organizacaoId} is not null)`,
    ),
    check(
      "utilizador_gestor_papel",
      sql`${t.gestorId} is null or ${t.papel} = 'utilizador'`,
    ),
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
