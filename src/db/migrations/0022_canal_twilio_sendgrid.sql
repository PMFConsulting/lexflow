-- Quinto canal de envio: Twilio SendGrid (opcional; produção futura).
--
-- O `canal_email` nasceu na 0010 com ('brevo','resend'); a 0011 acrescentou
-- 'mailjet'; a 0012 acrescentou 'smtp'; o `ADD VALUE` põe sempre o novo no fim
-- do tipo. O array do Drizzle em db/schema/enums.ts segue a mesma ordem:
-- brevo, resend, mailjet, smtp, twilio_sendgrid.
ALTER TYPE "public"."canal_email" ADD VALUE IF NOT EXISTS 'twilio_sendgrid' AFTER 'smtp';
