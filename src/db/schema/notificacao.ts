import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id } from "./_comum";
import { organizacao } from "./organizacao";

/**
 * Notificações in-app (Frente P).
 *
 * Substitui os avisos por email internos (novo processo submetido, novo utilizador,
 * sociedade criada).
 *
 * - `organizacao_id` NULL = notificação transversal de plataforma (visível pelo super_admin).
 * - `para_papel` = filtro de papel dentro da organização (ex: 'society_admin', 'gestor', 'utilizador') ou NULL para todos da sociedade.
 * - `lida_em` = timestamp em que a notificação foi marcada como lida (NULL = não lida).
 */
export const notificacao = pgTable(
  "notificacao",
  {
    id: id(),
    organizacaoId: uuid("organizacao_id").references(() => organizacao.id, {
      onDelete: "cascade",
    }),
    paraPapel: text("para_papel"),
    titulo: text("titulo").notNull(),
    corpo: text("corpo").notNull(),
    link: text("link"),
    lidaEm: timestamp("lida_em", { withTimezone: true }),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notificacao_org_lida_idx").on(t.organizacaoId, t.lidaEm),
    index("notificacao_criado_idx").on(t.criadoEm),
  ],
);

/**
 * Fila de notificações pendentes para o Resumo Diário enviado ao Dono da plataforma (Frente P).
 *
 * Eventos como novas sociedades criadas e novos utilizadores onboarded entram nesta fila
 * com `processado_em = null`. O cron diário `scripts/resumo_diario.mjs` recolhe as linhas
 * pendentes, agrega num email único às 9:00 e marca com `processado_em = now()`.
 */
export const notificacoesPendentes = pgTable(
  "notificacoes_pendentes",
  {
    id: id(),
    tipo: text("tipo").notNull(), // 'sociedade_criada' | 'novo_utilizador' | 'processo_submetido'
    organizacaoId: uuid("organizacao_id").references(() => organizacao.id, {
      onDelete: "set null",
    }),
    dados: jsonb("dados").$type<Record<string, unknown>>().notNull().default({}),
    processadoEm: timestamp("processado_em", { withTimezone: true }),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notificacoes_pendentes_proc_idx").on(t.processadoEm),
    index("notificacoes_pendentes_criado_idx").on(t.criadoEm),
  ],
);
