-- Novo papel 'gestor' e fluxo de aprovação de utilizadores pela plataforma.
--
-- 1. `papel_utilizador` passa a ter o valor 'gestor' (no fim do enum).
-- 2. `utilizador.gestor_id` — self-reference para utilizador.id (apenas para utilizadores).
-- 3. `utilizador.aprovado_em` — timestamp com timezone. Null = pendente; preenchido = aprovado.
-- 4. Backfill: todas as contas existentes ficam com `aprovado_em = now()`.
--
-- `IF NOT EXISTS` e blocos defensivos para garantir idempotência.

ALTER TYPE "public"."papel_utilizador" ADD VALUE IF NOT EXISTS 'gestor';--> statement-breakpoint
ALTER TABLE "utilizador" ADD COLUMN IF NOT EXISTS "gestor_id" uuid;--> statement-breakpoint
ALTER TABLE "utilizador" ADD COLUMN IF NOT EXISTS "aprovado_em" timestamp with time zone;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'utilizador_gestor_id_utilizador_id_fk'
      AND conrelid = 'public.utilizador'::regclass
  ) THEN
    ALTER TABLE "utilizador" ADD CONSTRAINT "utilizador_gestor_id_utilizador_id_fk"
      FOREIGN KEY ("gestor_id") REFERENCES "public"."utilizador"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'utilizador_gestor_papel'
      AND conrelid = 'public.utilizador'::regclass
  ) THEN
    ALTER TABLE "utilizador" ADD CONSTRAINT "utilizador_gestor_papel"
      CHECK ("gestor_id" IS NULL OR "papel" = 'utilizador');
  END IF;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "utilizador_gestor_id_idx" ON "utilizador" USING btree ("gestor_id");--> statement-breakpoint

UPDATE "utilizador" SET "aprovado_em" = now() WHERE "aprovado_em" IS NULL;
