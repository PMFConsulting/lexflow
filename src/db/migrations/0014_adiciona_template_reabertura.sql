-- Sexto valor do diário de emails: o aviso ao cliente quando um processo
-- rejeitado é reaberto no back-office e volta a `rascunho` para correção.
ALTER TYPE "public"."template_email" ADD VALUE IF NOT EXISTS 'reabertura';--> statement-breakpoint