import { index, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./_comum";
import { processoOnboarding } from "./processo";

/**
 * Código de verificação por email, pedido no fecho antes da assinatura.
 *
 * O link mágico é o único fator de quem assina, e viaja por email, cola-se em
 * conversas, fica em históricos. O código exige provar, no momento de
 * assinar, acesso à caixa de correio.
 *
 * Tabela própria e não coluna em `processo_onboarding`: um processo tem vários
 * códigos ao longo da vida, o histórico de tentativas permite ver força
 * bruta, e nada disto toca numa coluna existente.
 *
 * O código nunca é guardado em claro — só o SHA-256 de `processoId:codigo`
 * (processo como sal, mesma regra do token do link mágico, D4).
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
     * Para onde o código foi enviado — `email_log` responde pelo canal mas não
     * pela ligação ao processo no instante em que o código nasceu, e o cliente
     * pode ter corrigido o email do passo 1 entretanto.
     */
    enviadoPara: text("enviado_para").notNull(),
    expiraEm: timestamp("expira_em", { withTimezone: true }).notNull(),
    /** Tentativas de acerto. Ao quinto engano o código morre — sem limite, seis dígitos são uma tarde de script. */
    tentativas: smallint("tentativas").notNull().default(0),
    /** Quando foi acertado. Nulo = ainda não. */
    verificadoEm: timestamp("verificado_em", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [index("otp_processo").on(t.processoId, t.criadoEm)],
);
