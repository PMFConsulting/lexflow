import { index, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./_comum";
import { processoOnboarding } from "./processo";

/**
 * Código de verificação por email, pedido no fecho antes da assinatura.
 *
 * O que o passo 7 tinha era uma caixa de aceitação, uma rubrica desenhada com o
 * rato e um botão. Nada disso prova **quem** está do outro lado: o link mágico
 * é o único fator, e um link mágico é um segredo que viaja por email, se cola
 * em conversas e fica em históricos de browser. O código fecha essa distância —
 * quem assina tem de provar, no momento de assinar, que continua a ter acesso à
 * caixa de correio para onde a sociedade escreveu.
 *
 * Tabela nova e não coluna em `processo_onboarding` por três razões, todas
 * práticas: um processo tem vários códigos ao longo da vida (o cliente pede
 * outro, o primeiro expira), o histórico de tentativas é o que permite ver um
 * ataque de força bruta, e nada disto tem de tocar numa coluna existente.
 *
 * **O código nunca é guardado em claro.** Fica o SHA-256 de `processoId:codigo`
 * — o processo entra como sal para que dois processos com o mesmo código de seis
 * dígitos (que acontece, são só um milhão de hipóteses) não tenham o mesmo hash.
 * A mesma regra do token do link mágico, pela mesma razão (D4): quem tiver
 * leitura da base de dados não fica com a chave de nada.
 */
export const codigoOtp = pgTable(
  "codigo_otp",
  {
    id: id(),
    processoId: uuid("processo_id")
      .notNull()
      .references(() => processoOnboarding.id, { onDelete: "cascade" }),
    /** SHA-256 de `${processoId}:${codigo}`. Nunca o código. */
    codigoHash: text("codigo_hash").notNull(),
    /**
     * Para onde o código foi enviado.
     *
     * Guardado porque a pergunta que se faz a seguir a uma queixa é sempre a
     * mesma — "para que endereço é que isto foi?" —, e o `email_log` responde
     * pelo canal mas não pela ligação ao processo no instante em que o código
     * nasceu; o cliente pode ter corrigido o email do passo 1 pelo meio.
     */
    enviadoPara: text("enviado_para").notNull(),
    expiraEm: timestamp("expira_em", { withTimezone: true }).notNull(),
    /**
     * Quantas vezes já se tentou acertar. Ao quinto engano o código morre —
     * seis dígitos são um milhão de hipóteses, e sem limite de tentativas isso
     * é uma tarde de trabalho para um script.
     */
    tentativas: smallint("tentativas").notNull().default(0),
    /** Quando foi acertado. Nulo = ainda não. */
    verificadoEm: timestamp("verificado_em", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [index("otp_processo").on(t.processoId, t.criadoEm)],
);
