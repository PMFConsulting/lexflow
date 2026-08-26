-- Cada sociedade pode ter o seu próprio logótipo (whitelabel).
--
-- O logótipo é guardado em base64 com mime e nome originais (compromisso de POC).
-- A ausência destas colunas ou o valor NULL significa que a sociedade usa
-- o logótipo genérico do software ("LexFlow").
--
-- `IF NOT EXISTS` em todas para garantir idempotência.

ALTER TABLE "organizacao" ADD COLUMN IF NOT EXISTS "logotipo_dados" text;--> statement-breakpoint
ALTER TABLE "organizacao" ADD COLUMN IF NOT EXISTS "logotipo_mime" text;--> statement-breakpoint
ALTER TABLE "organizacao" ADD COLUMN IF NOT EXISTS "logotipo_nome" text;--> statement-breakpoint
ALTER TABLE "organizacao" ADD COLUMN IF NOT EXISTS "logotipo_atualizado_em" timestamp with time zone;
