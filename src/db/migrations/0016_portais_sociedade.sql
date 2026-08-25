-- Onboarding da sociedade, onboarding de utilizadores e os dois portais.
--
-- Manuscrita, como a 0015 e pela mesma razão: o `db:generate` compara com o
-- último snapshot e a 0015 não deixou nenhum, por isso propõe outra vez tudo o
-- que ela fez — incluindo um `CREATE TABLE "codigo_otp"` que rebentaria numa
-- base onde a tabela já existe. O snapshot `0016_snapshot.json` que a
-- acompanha é o estado completo e está correto; é só o SQL gerado que vinha a
-- duplicar história.
--
-- Tudo por adição. Nenhuma coluna existente é alterada, nenhuma tabela é
-- apagada e nenhuma migração anterior é tocada. Uma base em produção continua a
-- servir o código anterior enquanto esta não for aplicada.
--
-- Todos os `ADD VALUE`, `ADD COLUMN` e `CREATE` levam `IF NOT EXISTS`: esta
-- migração tem de poder ser reaplicada a uma base a que alguma coisa já tenha
-- sido dada à mão, e os valores novos ficam no **fim** de cada tipo, que é onde
-- o Postgres os põe e onde os arrays de `db/schema/enums.ts` têm de os ter.

-- ------------------------------------------------------------------ 1. tipos

CREATE TYPE "public"."estado_onboarding_sociedade" AS ENUM('rascunho', 'submetido', 'ativo');--> statement-breakpoint
CREATE TYPE "public"."estado_convite" AS ENUM('pendente', 'aceite', 'cancelado');--> statement-breakpoint
CREATE TYPE "public"."tipo_documento_organizacao" AS ENUM('termos_sociedade', 'identificacao', 'cedula_profissional', 'certidao_sociedade', 'outro');--> statement-breakpoint

-- Os dois convites internos entram no mesmo diário de emails que os do cliente.
ALTER TYPE "public"."template_email" ADD VALUE IF NOT EXISTS 'convite_sociedade';--> statement-breakpoint
ALTER TYPE "public"."template_email" ADD VALUE IF NOT EXISTS 'convite_utilizador';--> statement-breakpoint

-- ------------------------------------------------ 2. identidade da sociedade
--
-- Anuláveis porque a linha da organização nasce como casca no momento em que a
-- sociedade é convidada e só se enche quando alguém do lado dela percorre os
-- passos. A organização das seeds não tem nenhuma destas colunas e continua a
-- funcionar exatamente como antes — é esse o teste de o acrescento ser mesmo
-- por adição.

ALTER TABLE "organizacao" ADD COLUMN IF NOT EXISTS "natureza_juridica" text;--> statement-breakpoint
ALTER TABLE "organizacao" ADD COLUMN IF NOT EXISTS "numero_ordem" text;--> statement-breakpoint
ALTER TABLE "organizacao" ADD COLUMN IF NOT EXISTS "email_geral" text;--> statement-breakpoint
ALTER TABLE "organizacao" ADD COLUMN IF NOT EXISTS "telefone" text;--> statement-breakpoint
ALTER TABLE "organizacao" ADD COLUMN IF NOT EXISTS "website" text;--> statement-breakpoint
ALTER TABLE "organizacao" ADD COLUMN IF NOT EXISTS "morada" text;--> statement-breakpoint
ALTER TABLE "organizacao" ADD COLUMN IF NOT EXISTS "pais" text;--> statement-breakpoint
ALTER TABLE "organizacao" ADD COLUMN IF NOT EXISTS "localidade" text;--> statement-breakpoint
ALTER TABLE "organizacao" ADD COLUMN IF NOT EXISTS "codigo_postal" text;--> statement-breakpoint
ALTER TABLE "organizacao" ADD COLUMN IF NOT EXISTS "freguesia" text;--> statement-breakpoint
ALTER TABLE "organizacao" ADD COLUMN IF NOT EXISTS "concelho" text;--> statement-breakpoint
ALTER TABLE "organizacao" ADD COLUMN IF NOT EXISTS "distrito" text;--> statement-breakpoint

-- ---------------------------------------- 2b. a versão dos T&C que o cliente aceitou
--
-- `fecho_proposta.tc_aceitacao` dizia que o cliente aceitou e não dizia o quê.
-- É a armadilha da D3/D38 vista do lado do processo: subir uma versão nova do
-- articulado fazia as aceitações antigas parecerem aceitações do texto novo.
-- Anulável de propósito — as linhas anteriores a esta coluna não podem ganhar
-- retroativamente uma versão que ninguém gravou, e "aceitou, versão
-- desconhecida" é o estado real dessas.

ALTER TABLE "fecho_proposta" ADD COLUMN IF NOT EXISTS "tc_versao" text;--> statement-breakpoint

-- ------------------------------------------- 3. o onboarding da própria sociedade

CREATE TABLE IF NOT EXISTS "onboarding_sociedade" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"token_acesso_hash" text NOT NULL,
	"expira_em" timestamp with time zone,
	"estado" "estado_onboarding_sociedade" DEFAULT 'rascunho' NOT NULL,
	"passo_atual" smallint DEFAULT 1 NOT NULL,
	"submetido_em" timestamp with time zone,
	"admin_nome" text,
	"admin_email" text,
	"admin_telefone" text,
	"declaracao_vinculo" boolean DEFAULT false NOT NULL,
	"declaracao_nome" text,
	"declaracao_cargo" text,
	"extra" jsonb DEFAULT '{}'::jsonb,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"apagado_em" timestamp with time zone,
	CONSTRAINT "onboarding_sociedade_organizacao_id_unique" UNIQUE("organizacao_id"),
	CONSTRAINT "onboarding_sociedade_token_acesso_hash_unique" UNIQUE("token_acesso_hash"),
	-- Mesma restrição do `passo_valido` do processo do cliente, e pela mesma
	-- razão: um `passo_atual` fora do percurso é uma rota que não existe, e o
	-- sítio para o recusar é aqui e não só no código que escreve.
	CONSTRAINT "passo_sociedade_valido" CHECK ("passo_atual" between 1 and 6),
	CONSTRAINT "onboarding_sociedade_organizacao_id_organizacao_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacao"("id") ON DELETE cascade
);
--> statement-breakpoint

-- ---------------------------------------- 4. documentos que não são de processo

CREATE TABLE IF NOT EXISTS "documento_organizacao" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"convite_id" uuid,
	"tipo" "tipo_documento_organizacao" DEFAULT 'outro' NOT NULL,
	"nome_original" text NOT NULL,
	"mime" text NOT NULL,
	"tamanho_bytes" integer NOT NULL,
	"hash_sha256" text NOT NULL,
	"chave_storage" text NOT NULL,
	"dados" text,
	"validade" date,
	"carregado_por" uuid,
	"extra" jsonb DEFAULT '{}'::jsonb,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"apagado_em" timestamp with time zone,
	CONSTRAINT "documento_organizacao_organizacao_id_organizacao_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacao"("id") ON DELETE cascade,
	CONSTRAINT "documento_organizacao_carregado_por_utilizador_id_fk" FOREIGN KEY ("carregado_por") REFERENCES "public"."utilizador"("id") ON DELETE set null
);
--> statement-breakpoint

-- --------------------------------------------------------------- 5. convites

CREATE TABLE IF NOT EXISTS "convite_utilizador" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"email" text NOT NULL,
	"nome" text NOT NULL,
	"papel" "papel_utilizador" DEFAULT 'advogado' NOT NULL,
	"token_acesso_hash" text NOT NULL,
	"expira_em" timestamp with time zone,
	"estado" "estado_convite" DEFAULT 'pendente' NOT NULL,
	"passo_atual" smallint DEFAULT 1 NOT NULL,
	"utilizador_id" uuid,
	"aceite_em" timestamp with time zone,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"apagado_em" timestamp with time zone,
	CONSTRAINT "convite_utilizador_token_acesso_hash_unique" UNIQUE("token_acesso_hash"),
	CONSTRAINT "passo_convite_valido" CHECK ("passo_atual" between 1 and 6),
	CONSTRAINT "convite_utilizador_organizacao_id_organizacao_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacao"("id") ON DELETE cascade,
	CONSTRAINT "convite_utilizador_utilizador_id_utilizador_id_fk" FOREIGN KEY ("utilizador_id") REFERENCES "public"."utilizador"("id") ON DELETE set null,
	CONSTRAINT "convite_utilizador_criado_por_utilizador_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."utilizador"("id") ON DELETE set null
);
--> statement-breakpoint

-- ------------------------------------------------- 6. o perfil de cada pessoa

CREATE TABLE IF NOT EXISTS "perfil_utilizador" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"convite_id" uuid NOT NULL,
	"utilizador_id" uuid,
	"nome_completo" text,
	"data_nascimento" date,
	"nif" text,
	"telefone" text,
	"doc_tipo" "tipo_doc_id",
	"doc_numero" text,
	"doc_validade" date,
	"morada" text,
	"pais" text,
	"localidade" text,
	"codigo_postal" text,
	"freguesia" text,
	"concelho" text,
	"distrito" text,
	"cedula_profissional" text,
	"conselho_regional" text,
	"data_inscricao_oa" date,
	"cargo" text,
	"areas_pratica" text,
	"informacao_rgpd_em" timestamp with time zone,
	"sigilo_profissional" boolean DEFAULT false NOT NULL,
	"sigilo_aceite_em" timestamp with time zone,
	"comunicacoes_internas" boolean DEFAULT false NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"apagado_em" timestamp with time zone,
	CONSTRAINT "perfil_utilizador_convite_id_unique" UNIQUE("convite_id"),
	CONSTRAINT "perfil_utilizador_organizacao_id_organizacao_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacao"("id") ON DELETE cascade,
	CONSTRAINT "perfil_utilizador_convite_id_convite_utilizador_id_fk" FOREIGN KEY ("convite_id") REFERENCES "public"."convite_utilizador"("id") ON DELETE cascade,
	CONSTRAINT "perfil_utilizador_utilizador_id_utilizador_id_fk" FOREIGN KEY ("utilizador_id") REFERENCES "public"."utilizador"("id") ON DELETE cascade
);
--> statement-breakpoint

-- ------------------------------- 7. a aceitação dos T&C da sociedade, com prova
--
-- Nunca se atualiza. Uma versão nova do articulado produz uma linha nova, e a
-- antiga continua a dizer o que aquela pessoa aceitou naquele dia (D3/D38).

CREATE TABLE IF NOT EXISTS "aceitacao_termos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"convite_id" uuid,
	"utilizador_id" uuid,
	"versao" text NOT NULL,
	"documento_ref" text,
	"aceite_em" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text NOT NULL,
	"user_agent" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "aceitacao_termos_organizacao_id_organizacao_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacao"("id") ON DELETE cascade,
	CONSTRAINT "aceitacao_termos_convite_id_convite_utilizador_id_fk" FOREIGN KEY ("convite_id") REFERENCES "public"."convite_utilizador"("id") ON DELETE set null,
	CONSTRAINT "aceitacao_termos_utilizador_id_utilizador_id_fk" FOREIGN KEY ("utilizador_id") REFERENCES "public"."utilizador"("id") ON DELETE set null
);
--> statement-breakpoint

-- ------------------------------------------------------------------ 8. índices
--
-- As chaves estrangeiras vão dentro do `CREATE TABLE`, e não em `ALTER TABLE`
-- separados: `ADD CONSTRAINT` não tem `IF NOT EXISTS` no Postgres, e envolver
-- cada um num bloco `DO ... EXCEPTION` (que é a receita habitual) trava o PGlite
-- do `pnpm db:validar` — a validação deixaria de correr, que é o preço mais caro
-- possível para uma diferença de estilo. Dentro do `CREATE TABLE IF NOT EXISTS`
-- a tabela e as suas restrições são uma coisa só, e a reaplicação é inofensiva.

CREATE INDEX IF NOT EXISTS "onboarding_sociedade_estado" ON "onboarding_sociedade" USING btree ("estado");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documento_org" ON "documento_organizacao" USING btree ("organizacao_id","tipo");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documento_org_convite" ON "documento_organizacao" USING btree ("convite_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "convite_org" ON "convite_utilizador" USING btree ("organizacao_id","estado");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "convite_email" ON "convite_utilizador" USING btree ("organizacao_id","email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "perfil_org" ON "perfil_utilizador" USING btree ("organizacao_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "perfil_utilizador_unico" ON "perfil_utilizador" USING btree ("utilizador_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "aceitacao_org" ON "aceitacao_termos" USING btree ("organizacao_id","versao");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "aceitacao_utilizador" ON "aceitacao_termos" USING btree ("utilizador_id");
