-- 0026_notificacoes_e_resumo_diario.sql
-- 1. Preferência da sociedade para receber ou não emails a cada submissão (default: false / OFF)
ALTER TABLE "organizacao" ADD COLUMN IF NOT EXISTS "notificar_submissoes_email" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- 2. Tabela de notificações in-app (badge/sino no backoffice)
CREATE TABLE IF NOT EXISTS "notificacao" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizacao_id" uuid,
	"para_papel" text,
	"titulo" text NOT NULL,
	"corpo" text NOT NULL,
	"link" text,
	"lida_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notificacao" ADD CONSTRAINT "notificacao_organizacao_id_organizacao_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacao"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notificacao_org_lida_idx" ON "notificacao" ("organizacao_id", "lida_em");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notificacao_criado_idx" ON "notificacao" ("criado_em");
--> statement-breakpoint
-- 3. Tabela de fila de notificações pendentes para o resumo diário do Dono
CREATE TABLE IF NOT EXISTS "notificacoes_pendentes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tipo" text NOT NULL,
	"organizacao_id" uuid,
	"dados" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"processado_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notificacoes_pendentes" ADD CONSTRAINT "notificacoes_pendentes_organizacao_id_organizacao_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacao"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notificacoes_pendentes_proc_idx" ON "notificacoes_pendentes" ("processado_em");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notificacoes_pendentes_criado_idx" ON "notificacoes_pendentes" ("criado_em");
