-- Terceiro canal de envio: Mailjet (200 emails/dia no plano gratuito).
--
-- O `canal_email` nasceu na 0010 com ('brevo','resend') e o `ADD VALUE` põe o
-- novo valor no fim do tipo. O array do Drizzle em `db/schema/enums.ts` tem de
-- bater com essa ordem (brevo, resend, mailjet) — divergirem faz o `db:generate`
-- seguinte propor uma migração a corrigir o que não está errado. O `IF NOT
-- EXISTS` é para a migração poder ser reaplicada a uma base que já a tenha
-- levado à mão.
ALTER TYPE "public"."canal_email" ADD VALUE IF NOT EXISTS 'mailjet';
