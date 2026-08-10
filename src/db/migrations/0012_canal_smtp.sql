-- Quarto canal de envio: SMTP próprio (postfix no servidor do cliente).
--
-- O `canal_email` nasceu na 0010 com ('brevo','resend'); a 0011 acrescentou
-- 'mailjet'; o `ADD VALUE` põe sempre o novo no fim do tipo. O array do
-- Drizzle em db/schema/enums.ts segue a mesma ordem: brevo, resend, mailjet,
-- smtp.
ALTER TYPE "public"."canal_email" ADD VALUE IF NOT EXISTS 'smtp';
