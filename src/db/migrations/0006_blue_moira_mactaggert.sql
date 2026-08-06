CREATE TYPE "public"."tipo_armazenamento" AS ENUM('onedrive', 'servidor');--> statement-breakpoint
CREATE TABLE "armazenamento_sociedade" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"tipo" "tipo_armazenamento" DEFAULT 'onedrive' NOT NULL,
	"parametros" jsonb,
	"pasta_raiz" text DEFAULT '/Clientes' NOT NULL,
	"ativo" boolean DEFAULT false NOT NULL,
	"ultima_sincronizacao_em" timestamp with time zone,
	"ultimo_erro" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "armazenamento_sociedade" ADD CONSTRAINT "armazenamento_sociedade_organizacao_id_organizacao_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacao"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "armazenamento_org" ON "armazenamento_sociedade" USING btree ("organizacao_id");--> statement-breakpoint
-- Linha por omissão para as sociedades que já existem: OneDrive, sem
-- credenciais e desligada. A configuração faz-se depois, com
-- `pnpm armazenamento configurar` — ver docs/ARMAZENAMENTO.md.
--
-- `gen_random_uuid()` e não `uuidv7()`: a decisão D15 vale para a aplicação,
-- mas o Postgres só tem `uuidv7()` nativo na v18 e isto corre em SQL cru.
INSERT INTO "armazenamento_sociedade" ("id", "organizacao_id", "tipo", "ativo")
SELECT gen_random_uuid(), o."id", 'onedrive', false
FROM "organizacao" o
ON CONFLICT DO NOTHING;