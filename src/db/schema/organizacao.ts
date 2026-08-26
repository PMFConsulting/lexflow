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

    /* ----------------------------------------------- T&C da própria sociedade
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
     * já por uma razão prática: o dia em que a sociedade entregar o documento
     * não pode ser um dia de migração com o sistema a correr. Ficam anuláveis e
     * sem leitor nenhum a depender delas — enquanto forem `null`, tudo se
     * comporta exatamente como antes.
     *
     * O que falta para acionar está escrito em `docs/TERMOS_SOCIEDADE.md`, e o
     * ponto que não se pode esquecer é o da D3/D38: os consentimentos apontam
     * para uma **versão**, e substituir o texto sem subir a versão apaga a
     * diferença entre o que o cliente aceitou e o que passou a estar escrito.
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
    authUserId: text("auth_user_id").unique(),
    nome: text("nome").notNull(),
    email: text("email").notNull(),
    /**
     * `utilizador` como valor por omissão, no lugar do antigo `assistente`: o
     * papel que menos pode é o que se dá a quem chega sem se dizer nada. Um
     * `super_admin` por omissão seria um erro de digitação a valer a
     * plataforma inteira.
     */
    papel: papelUtilizador("papel").notNull().default("utilizador"),
    ativo: boolean("ativo").notNull().default(true),
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
    index("utilizador_org").on(t.organizacaoId),
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
