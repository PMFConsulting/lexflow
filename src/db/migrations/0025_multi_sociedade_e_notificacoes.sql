-- 0025_multi_sociedade_e_notificacoes.sql
-- 1. Permite que o mesmo utilizador de autenticação (Better Auth) seja society_admin
--    de múltiplas organizações. Substitui a constraint global única em auth_user_id
--    por unicidade composta por organização.
ALTER TABLE "utilizador" DROP CONSTRAINT IF EXISTS "utilizador_auth_user_id_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "utilizador_auth_org" ON "utilizador" ("organizacao_id", "auth_user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "utilizador_auth_plataforma" ON "utilizador" ("auth_user_id") WHERE "organizacao_id" IS NULL;
--> statement-breakpoint
-- 2. Adiciona os novos templates de notificação ao Dono da plataforma
ALTER TYPE "public"."template_email" ADD VALUE IF NOT EXISTS 'notificacao_sociedade_criada';
--> statement-breakpoint
ALTER TYPE "public"."template_email" ADD VALUE IF NOT EXISTS 'notificacao_novo_utilizador';
