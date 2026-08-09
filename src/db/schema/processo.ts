import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, softDelete, timestamps, tsvector } from "./_comum";
import { estadoProcesso, nivelRisco, tipoCliente } from "./enums";
import { organizacao, utilizador } from "./organizacao";

/** Um fator que puxou o risco para cima, com o porquê legível. */
export type FatorRisco = {
  codigo: string;
  descricao: string;
  peso: number;
};

export const processoOnboarding = pgTable(
  "processo_onboarding",
  {
    id: id(),
    organizacaoId: uuid("organizacao_id")
      .notNull()
      .references(() => organizacao.id, { onDelete: "restrict" }),
    /** PMF-2026-0142 — única por organização. */
    referencia: text("referencia").notNull(),
    tipoCliente: tipoCliente("tipo_cliente").notNull(),
    /**
     * Dados de abertura: o que a sociedade sabia do cliente no momento em que
     * criou o processo, antes de o cliente preencher fosse o que fosse.
     *
     * Anuláveis e à parte das secções de propósito. Não são o que o cliente
     * declarou — são o que a sociedade escreveu ao abrir o dossier, e as duas
     * coisas têm de continuar distinguíveis. Numa pessoa coletiva o NIPC e a
     * denominação são obrigatórios à abertura; numa pessoa singular o nome é
     * opcional e não há NIF nenhum a pedir.
     */
    nomeCliente: text("nome_cliente"),
    nifCliente: text("nif_cliente"),
    emailCliente: text("email_cliente"),
    estado: estadoProcesso("estado").notNull().default("rascunho"),
    passoAtual: smallint("passo_atual").notNull().default(1),
    responsavelId: uuid("responsavel_id").references(() => utilizador.id, {
      onDelete: "set null",
    }),
    nivelRisco: nivelRisco("nivel_risco").notNull().default("baixo"),
    /** O porquê do nível, para o mostrar sempre ao lado do badge — §6 do brief. */
    fatoresRisco: jsonb("fatores_risco").$type<FatorRisco[]>().notNull().default([]),
    /**
     * SHA-256 do token do link mágico, nunca o token em claro: quem tiver
     * leitura da BD não fica com a chave de todos os dossiers.
     */
    tokenAcessoHash: text("token_acesso_hash").notNull(),
    expiraEm: timestamp("expira_em", { withTimezone: true }),
    submetidoEm: timestamp("submetido_em", { withTimezone: true }),
    aprovadoEm: timestamp("aprovado_em", { withTimezone: true }),
    aprovadoPor: uuid("aprovado_por").references(() => utilizador.id, {
      onDelete: "set null",
    }),
    motivoRejeicao: text("motivo_rejeicao"),
    /** Mantida por trigger sobre nome + NIF + referência. Ver migração 0001. */
    pesquisa: tsvector("pesquisa"),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    uniqueIndex("processo_referencia_org").on(t.organizacaoId, t.referencia),
    uniqueIndex("processo_token").on(t.tokenAcessoHash),
    index("processo_estado").on(t.organizacaoId, t.estado),
    index("processo_risco").on(t.organizacaoId, t.nivelRisco),
    index("processo_responsavel").on(t.responsavelId),
    index("processo_pesquisa").using("gin", t.pesquisa),
    check("passo_valido", sql`${t.passoAtual} between 1 and 7`),
  ],
);

/** Notas internas. Nunca visíveis ao cliente — e isso garante-se na query. */
export const nota = pgTable(
  "nota",
  {
    id: id(),
    processoId: uuid("processo_id")
      .notNull()
      .references(() => processoOnboarding.id, { onDelete: "cascade" }),
    autorId: uuid("autor_id").references(() => utilizador.id, { onDelete: "set null" }),
    conteudo: text("conteudo").notNull(),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [index("nota_processo").on(t.processoId, t.criadoEm)],
);
