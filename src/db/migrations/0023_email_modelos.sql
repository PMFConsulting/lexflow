-- Modelos de email personalizáveis por sociedade (Frente J).
--
-- Permite que cada sociedade personalize o assunto e o corpo HTML dos emails
-- dirigidos a clientes (boas_vindas, rejeicao, reabertura, confirmacao_rececao).
--
-- Se a sociedade não personalizar, a plataforma utiliza os textos padrão (100% retrocompatível).
-- Templates de segurança e sistema (otp, credenciais, convites, registo, aviso interno)
-- permanecem não editáveis.

CREATE TABLE IF NOT EXISTS "email_modelo" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organizacao_id" uuid NOT NULL,
  "template" "public"."template_email" NOT NULL,
  "assunto" text NOT NULL,
  "corpo_html" text NOT NULL,
  "atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
  "atualizado_por" uuid
);--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'email_modelo_organizacao_id_organizacao_id_fk'
      AND conrelid = 'public.email_modelo'::regclass
  ) THEN
    ALTER TABLE "email_modelo" ADD CONSTRAINT "email_modelo_organizacao_id_organizacao_id_fk"
      FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacao"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'email_modelo_atualizado_por_utilizador_id_fk'
      AND conrelid = 'public.email_modelo'::regclass
  ) THEN
    ALTER TABLE "email_modelo" ADD CONSTRAINT "email_modelo_atualizado_por_utilizador_id_fk"
      FOREIGN KEY ("atualizado_por") REFERENCES "public"."utilizador"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "email_modelo_org_template_unique" ON "email_modelo" USING btree ("organizacao_id", "template");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_modelo_org_idx" ON "email_modelo" USING btree ("organizacao_id");
