-- Revisão de produto de 23/08/2026 — tudo por adição.
--
-- Nenhuma coluna existente é alterada e nenhuma tabela é apagada: uma base que
-- já esteja em produção continua a servir o código anterior enquanto esta não
-- for aplicada, e o código novo trata todas as colunas novas como anuláveis.
--
-- Quatro coisas, e a ordem entre elas é indiferente:
--   1. dois valores no `tipo_documento` — a proposta comercial que a sociedade
--      anexa ao convite, e o slot (por acionar) dos T&C da própria sociedade;
--   2. um valor no `template_email` — o código de verificação do fecho;
--   3. três colunas em `organizacao` para o articulado da sociedade, todas
--      anuláveis e sem nada a lê-las ainda (ver docs/TERMOS_SOCIEDADE.md);
--   4. a tabela `codigo_otp`.
--
-- Os `ADD VALUE` vão com `IF NOT EXISTS` para a migração poder ser reaplicada a
-- uma base a que os valores já tenham sido dados à mão, e os valores novos
-- ficam no **fim** do tipo — que é onde o Postgres os põe e onde os arrays do
-- `db/schema/enums.ts` têm de os ter, senão o `db:generate` seguinte propõe uma
-- migração a corrigir o que não está errado.

ALTER TYPE "public"."tipo_documento" ADD VALUE IF NOT EXISTS 'proposta_comercial';--> statement-breakpoint
ALTER TYPE "public"."tipo_documento" ADD VALUE IF NOT EXISTS 'termos_sociedade';--> statement-breakpoint
ALTER TYPE "public"."template_email" ADD VALUE IF NOT EXISTS 'otp';--> statement-breakpoint

-- Os T&C da sociedade. Slot preparado, por acionar: enquanto forem NULL, o
-- passo 7 continua a servir o texto da plataforma (`src/lib/termos.ts`).
ALTER TABLE "organizacao" ADD COLUMN IF NOT EXISTS "termos_documento_ref" text;--> statement-breakpoint
ALTER TABLE "organizacao" ADD COLUMN IF NOT EXISTS "termos_versao" text;--> statement-breakpoint
ALTER TABLE "organizacao" ADD COLUMN IF NOT EXISTS "termos_atualizado_em" timestamp with time zone;--> statement-breakpoint

-- Código de verificação por email, no fecho.
--
-- `codigo_hash` e não `codigo`: é o SHA-256 de `processo_id:codigo`, com o
-- processo a servir de sal para que dois processos com o mesmo código de seis
-- dígitos não partilhem o hash. Mesma regra do token do link mágico (D4).
--
-- `on delete cascade` porque um código sem processo não é prova de nada — ao
-- contrário de `evento_auditoria`, que é onde o rasto legal fica e que não
-- desaparece com nada.
CREATE TABLE IF NOT EXISTS "codigo_otp" (
  "id" uuid PRIMARY KEY NOT NULL,
  "processo_id" uuid NOT NULL,
  "codigo_hash" text NOT NULL,
  "enviado_para" text NOT NULL,
  "expira_em" timestamp with time zone NOT NULL,
  "tentativas" smallint DEFAULT 0 NOT NULL,
  "verificado_em" timestamp with time zone,
  "criado_em" timestamp with time zone DEFAULT now() NOT NULL,
  "atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "codigo_otp_processo_id_processo_onboarding_id_fk"
    FOREIGN KEY ("processo_id") REFERENCES "public"."processo_onboarding"("id") ON DELETE cascade
);--> statement-breakpoint

-- Por processo e por data: as duas consultas que existem são "o código mais
-- recente deste processo" e "os códigos deste processo", e as duas são a mesma
-- varredura com o índice a servi-la ordenada.
CREATE INDEX IF NOT EXISTS "otp_processo" ON "codigo_otp" USING btree ("processo_id","criado_em");
