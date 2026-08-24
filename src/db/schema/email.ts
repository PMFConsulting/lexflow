import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id } from "./_comum";
import { canalEmail, estadoEmail, templateEmail } from "./enums";
import { organizacao } from "./organizacao";
import { processoOnboarding } from "./processo";

/**
 * A record of every email the system attempted to send.
 *
 * One row per attempt, written by `enviarEmail` — which means no sending path
 * can forget it, including the ones that do not yet exist. Success and error
 * both go in: "nothing reached the client" is the question being asked, and it
 * only has an answer if failures are recorded with the reason.
 *
 * This is not the audit trail and does not replace it. `evento_auditoria` is
 * append-only, with a hash chain, and still records what sending a link means
 * for the matter (`link.enviado` / `link.envio_falhou`); this is the email
 * channel's technical log, which can be truncated and rebuilt with no legal
 * consequence.
 *
 * It does not store the message body. A welcome email carries the matter's
 * summary as an attachment, and duplicating personal data into a diagnostic
 * table multiplies the surface of a GDPR-subject system for nothing.
 */
export const emailLog = pgTable(
  "email_log",
  {
    id: id(),
    /**
     * Null when the send happens outside the context of an organisation. That
     * does not happen today; the column accepts it so a send is never left
     * unrecorded just because there was nobody to attribute it to.
     */
    organizacaoId: uuid("organizacao_id").references(() => organizacao.id, {
      onDelete: "set null",
    }),
    /**
     * `set null` and not `cascade`: deleting a matter cannot delete the
     * evidence that the client was written to. The row stays, without a matter.
     */
    processoId: uuid("processo_id").references(() => processoOnboarding.id, {
      onDelete: "set null",
    }),
    /** Recipient, exactly as it was passed to the provider. */
    para: text("para").notNull(),
    assunto: text("assunto").notNull(),
    template: templateEmail("template").notNull(),
    /**
     * SHA-256 of the magic link token, when the email carries one — and never
     * the plaintext token. Storing it here would undo D4: reading this table
     * would be enough to enter any case file. The hash is enough to cross the
     * row with `processo_onboarding.token_acesso_hash` and answer "which link
     * was sent in this message".
     */
    tokenHash: text("token_hash"),
    estado: estadoEmail("estado").notNull(),
    /**
     * Filled in when there is a reason: the provider's error refusing the send,
     * or the reason for a `devolvido`. An `entregue` does not erase it — the
     * reason an earlier attempt failed still stands.
     */
    erro: text("erro"),
    /**
     * Which of the two channels accepted the message. Null when neither did.
     *
     * It is what decides who gets asked for the outcome: one provider's
     * `mensagem_id` means nothing to the other.
     */
    canal: canalEmail("canal"),
    /**
     * The identifier the provider gave the message — Resend's `id`, Brevo's
     * `messageId`. It is not a secret (it opens nothing, unlike the token) and
     * it is the only way to go back and ask what was done with the message.
     *
     * Null when the provider accepted without returning a recognisable id: in
     * that case delivery is not confirmable, and the row stays at `enviado`
     * forever.
     */
    mensagemId: text("mensagem_id"),
    /**
     * When the outcome was confirmed with the provider. Null while nobody has
     * asked — which is what distinguishes "it is not yet known" from "it was
     * asked and the provider said it delivered".
     */
    verificadoEm: timestamp("verificado_em", { withTimezone: true }),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("email_log_criado").on(t.criadoEm),
    index("email_log_processo").on(t.processoId),
    index("email_log_estado").on(t.estado),
    // To reach the row from an id in the provider's dashboard — and, one day,
    // from a webhook's body.
    index("email_log_mensagem").on(t.mensagemId),
  ],
);
