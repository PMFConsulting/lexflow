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
 * Multi-tenant desde o dia 1: hoje a PMF, amanhã outras sociedades.
 *
 * Até à `0016` "amanhã" era uma promessa do esquema sem nada que a cumprisse —
 * a única sociedade nascia de uma seed. Agora nasce no portal do `super_admin`,
 * e é por isso que as duas restrições de unicidade aparecem só aqui: enquanto
 * houve uma linha só, nada podia colidir com nada.
 */
export const organizacao = pgTable(
  "organizacao",
  {
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
     * O `documento.id` do PDF dos T&C da sociedade (tipo `termos_sociedade`),
     * ou `null` enquanto ela não o submeter.
     *
     * Sem `references()` de propósito: o documento vive pendurado num processo
     * (`documento.processo_id` é `not null`) e os T&C da sociedade não são de
     * processo nenhum. Quando o slot for acionado, ou a coluna passa a apontar
     * para uma tabela própria de documentos da sociedade, ou `processo_id`
     * deixa de ser obrigatório — as duas são decisões a tomar com o articulado
     * à frente, e nenhuma delas se toma bem hoje. Uma FK inventada agora era
     * uma restrição a defender uma forma que ainda não se sabe qual é.
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

    /* ------------------------------------------- Email do domínio da sociedade
     *
     * Até aqui os quatro canais de envio partilhavam um remetente só — o
     * `EMAIL_REMETENTE` do ambiente, `POC@jmassano.pt` por omissão. Numa
     * instalação com uma sociedade isso passa despercebido; com duas, o cliente
     * da segunda recebe um pedido de dados pessoais assinado com o domínio da
     * primeira, e a resposta certa dele é não responder.
     *
     * As cinco colunas são anuláveis, e a ausência tem um significado só:
     * **esta sociedade ainda usa o remetente global**. É o que faz a adição ser
     * mesmo aditiva — a sociedade sementeada não tem nenhuma delas e continua a
     * enviar exatamente como enviava.
     */

    /**
     * O endereço `From` desta sociedade (`geral@andradecosta.pt`).
     *
     * Guardado mesmo antes de o domínio estar verificado: é ele que se vê no
     * ecrã como "remetente efetivo", e escondê-lo até à verificação tirava a
     * quem configura a única forma de confirmar que escreveu o endereço certo.
     * O preço de o usar cedo demais é um 403 da Resend com o remetente à
     * frente, que é uma mensagem que se resolve à primeira leitura (D43).
     */
    emailRemetente: text("email_remetente"),
    /**
     * O domínio de envio (`andradecosta.pt`), sem a parte local.
     *
     * Separado do `emailRemetente` de propósito: é o domínio que se verifica na
     * Resend, e um endereço pode mudar (`geral@` → `advogados@`) sem que a
     * verificação de SPF/DKIM tenha de ser refeita.
     */
    dominioEmail: text("dominio_email"),
    /** O `id` do domínio na Resend — sem ele não há a quem perguntar o estado. */
    dominioResendId: text("dominio_resend_id"),
    /** Quando é que a Resend disse `verified` pela primeira vez. */
    dominioVerificadoEm: timestamp("dominio_verificado_em", { withTimezone: true }),
    /**
     * Espelho do `status` da Resend: `not_started`, `pending`, `verified`,
     * `failed` (e o `temporary_failure` que ela também devolve).
     *
     * `text` e não um enum do Postgres: o conjunto de valores é de outra pessoa
     * e muda quando ela quiser. Um enum obrigava a uma migração no dia em que a
     * Resend acrescentasse um estado, e entretanto a escrita rebentava — o que
     * transformava uma verificação de DNS numa falha da plataforma.
     */
    dominioEstado: text("dominio_estado"),

    /* ------------------------------------------- Logótipo próprio da sociedade
     *
     * Permite que cada sociedade use a sua própria marca no portal em vez do
     * logótipo genérico "LexFlow". Guardado em base64 com mime e nome originais (POC).
     *
     * Todas as colunas são anuláveis: `null` significa uma coisa só — esta sociedade
     * usa o logótipo padrão do software ("LexFlow").
     */
    logotipoDados: text("logotipo_dados"),
    logotipoMime: text("logotipo_mime"),
    logotipoNome: text("logotipo_nome"),
    logotipoAtualizadoEm: timestamp("logotipo_atualizado_em", { withTimezone: true }),

    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    /**
     * O prefixo é a primeira sílaba de toda a referência de processo
     * (`PMF-2026-0142`) e é o que separa visualmente os dossiers de duas
     * sociedades. Duas com o mesmo prefixo produzem referências que se leem
     * como sendo da mesma casa — e a referência aparece em emails, em PDFs de
     * arquivo e no assunto do aviso interno, ou seja, em sítios que ninguém
     * volta atrás para corrigir.
     *
     * O índice é **parcial** nas duas: uma sociedade apagada não pode ficar a
     * reservar o prefixo dela para sempre. Recusar `PMF` a uma sociedade nova
     * por causa de uma linha que já ninguém vê seria um erro sem explicação
     * possível na interface.
     */
    uniqueIndex("organizacao_prefixo")
      .on(t.prefixoReferencia)
      .where(sql`${t.apagadoEm} is null`),
    uniqueIndex("organizacao_nif").on(t.nif).where(sql`${t.apagadoEm} is null`),
  ],
);

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
    /**
     * A sociedade a que pertence — **anulável desde a migração `0016`**.
     *
     * `NULL` significa uma coisa só: `super_admin`, o dono da plataforma. Não é
     * um "ainda não sei", e a restrição `utilizador_org_por_papel` abaixo é o
     * que impede que passe a sê-lo. A alternativa era inventar uma organização
     * "plataforma" para ele viver dentro — e essa aparecia na lista de
     * sociedades, contava nos totais e mais cedo ou mais tarde alguém lhe
     * criava um processo.
     *
     * O `NULL` não é só arrumação: é ele que faz o isolamento acontecer sem
     * nenhuma consulta mudar. Todas comparam `processo.organizacao_id` com a de
     * quem lê, e `NULL = <o que quer que seja>` é `NULL`, nunca verdadeiro.
     */
    organizacaoId: uuid("organizacao_id").references(() => organizacao.id, {
      onDelete: "restrict",
    }),
    authUserId: text("auth_user_id"),
    nome: text("nome").notNull(),
    email: text("email").notNull(),
    /**
     * `utilizador` como valor por omissão, no lugar do antigo `assistente`: o
     * papel que menos pode é o que se dá a quem chega sem se dizer nada. Um
     * `super_admin` por omissão seria um erro de digitação a valer a
     * plataforma inteira.
     */
    papel: papelUtilizador("papel").notNull().default("utilizador"),
    /**
     * O gestor a quem esta pessoa está associada — só para o papel
     * `utilizador`, e garantido pela `utilizador_gestor_papel` mais abaixo.
     *
     * A anotação `AnyPgColumn` é o que a auto-referência exige: sem ela o
     * TypeScript não consegue inferir o tipo de uma tabela que se refere a si
     * própria enquanto ainda a está a construir. É o tipo que o Drizzle publica
     * para este caso, e não um `any` — que compilava na mesma e desligava a
     * verificação de que o alvo da chave é mesmo uma coluna.
     *
     * `on delete set null` e não `cascade`: um gestor que sai da sociedade não
     * pode levar consigo as contas de quem coordenava.
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
     * A pessoa tem de definir uma palavra-passe nova antes de usar a
     * plataforma.
     *
     * Uma conta criada por um administrador nasce com uma palavra-passe que a
     * plataforma gerou e enviou por email — ou seja, com um segredo que já
     * viajou por um canal que não é secreto e que ninguém escolheu. Enquanto
     * esta coluna estiver a `true`, `exigirSessao()` manda a pessoa para
     * `/definir-palavra-passe` e não a deixa passar dali: o início de sessão
     * confirma quem ela é, e a redefinição é o que transforma a credencial
     * temporária numa credencial dela.
     *
     * **A coluna vive aqui e não em `user`** — a tabela do Better Auth não leva
     * colunas de negócio (D2). O que ela guarda é a autenticação; isto é uma
     * regra do produto sobre quem já se autenticou.
     *
     * O valor por omissão é `false`, e é uma decisão e não uma distração: a
     * migração é aditiva, e um `default true` punha **todas** as contas
     * existentes a redefinir a palavra-passe no login seguinte — pessoas que
     * escolheram a sua e não têm nada a corrigir. Quem nasce com uma
     * palavra-passe gerada é marcado explicitamente (`criarConta`); quem a
     * escolhe no próprio registo (`concluirConvite`) fica em `false`, que é o
     * que a ausência de marca já dizia.
     */
    deveRedefinirPassword: boolean("deve_redefinir_password").notNull().default(false),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    uniqueIndex("utilizador_email_org").on(t.organizacaoId, t.email),
    /**
     * O índice de cima não cobre os `super_admin`, e não é por distração: no
     * Postgres dois `NULL` não colidem num índice único, por isso
     * `(NULL, 'ana@x.pt')` cabe lá dentro tantas vezes quantas se inserirem.
     * Duas linhas de plataforma com o mesmo email davam duas resoluções
     * possíveis para a mesma conta do Better Auth — e `sessaoAtual()` resolve
     * por `auth_user_id` com `limit(1)`, ou seja, escolhia uma ao acaso.
     *
     * Este índice parcial fecha exatamente essa porta, e só essa: quem tem
     * sociedade continua a ser único por (sociedade, email), como sempre foi.
     */
    uniqueIndex("utilizador_email_plataforma")
      .on(t.email)
      .where(sql`${t.organizacaoId} is null`),
    /**
     * Unicidade de auth_user_id por organização (migração 0025):
     * Permite que a mesma conta de autenticação (Better Auth) seja admin de
     * múltiplas sociedades sem colidir globalmente.
     */
    uniqueIndex("utilizador_auth_org").on(t.organizacaoId, t.authUserId),
    uniqueIndex("utilizador_auth_plataforma")
      .on(t.authUserId)
      .where(sql`${t.organizacaoId} is null`),
    index("utilizador_org").on(t.organizacaoId),
    index("utilizador_gestor_id_idx").on(t.gestorId),
    /**
     * A regra de negócio escrita onde não se pode contornar.
     *
     * O gate existe também no Server Action que cria contas (é lá que dá uma
     * mensagem em português a quem se enganou), mas um `check` não é
     * duplicação: o Server Action protege o caminho da interface, e isto
     * protege os outros — o `scripts/criar_utilizador.mjs`, um `UPDATE` à mão
     * numa sessão de psql, a seed. Um `society_admin` sem sociedade entra na
     * plataforma e não vê processo nenhum, sem erro nenhum a dizer porquê; é a
     * espécie de linha que se descobre semanas depois, do lado errado de uma
     * chamada telefónica.
     */
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
