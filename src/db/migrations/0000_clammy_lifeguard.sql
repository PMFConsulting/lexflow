CREATE TYPE "public"."estado_processo" AS ENUM('rascunho', 'submetido', 'em_revisao', 'pendente_cliente', 'aprovado', 'rejeitado', 'arquivado');--> statement-breakpoint
CREATE TYPE "public"."finalidade_consentimento" AS ENUM('newsletter', 'convites_iniciativas', 'declaracao_veracidade', 'termos_condicoes', 'proposta');--> statement-breakpoint
CREATE TYPE "public"."nivel_risco" AS ENUM('baixo', 'medio', 'elevado');--> statement-breakpoint
CREATE TYPE "public"."origem_contacto" AS ENUM('recomendacao', 'pesquisa_online', 'evento_conferencia', 'outro');--> statement-breakpoint
CREATE TYPE "public"."papel_utilizador" AS ENUM('admin', 'socio', 'advogado', 'assistente');--> statement-breakpoint
CREATE TYPE "public"."regime_iva" AS ENUM('normal', 'isento_art53', 'isento_art9', 'misto');--> statement-breakpoint
CREATE TYPE "public"."tipo_cliente" AS ENUM('particular', 'empresa');--> statement-breakpoint
CREATE TYPE "public"."tipo_doc_id" AS ENUM('cartao_cidadao', 'passaporte', 'titulo_residencia', 'outro');--> statement-breakpoint
CREATE TYPE "public"."tipo_documento" AS ENUM('identificacao', 'comprovativo_nif', 'certidao_permanente', 'procuracao', 'ata_designacao', 'comprovativo_rcbe', 'dossier_assinado', 'outro');--> statement-breakpoint
CREATE TYPE "public"."titular_nacionalidade" AS ENUM('cliente', 'representante');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contador_referencia" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"ano" integer NOT NULL,
	"ultimo" integer DEFAULT 0 NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizacao" (
	"id" uuid PRIMARY KEY NOT NULL,
	"nome" text NOT NULL,
	"nif" text NOT NULL,
	"prefixo_referencia" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"apagado_em" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "utilizador" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"auth_user_id" text,
	"nome" text NOT NULL,
	"email" text NOT NULL,
	"papel" "papel_utilizador" DEFAULT 'assistente' NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"apagado_em" timestamp with time zone,
	CONSTRAINT "utilizador_auth_user_id_unique" UNIQUE("auth_user_id")
);
--> statement-breakpoint
CREATE TABLE "nota" (
	"id" uuid PRIMARY KEY NOT NULL,
	"processo_id" uuid NOT NULL,
	"autor_id" uuid,
	"conteudo" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"apagado_em" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "processo_onboarding" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"referencia" text NOT NULL,
	"tipo_cliente" "tipo_cliente" NOT NULL,
	"estado" "estado_processo" DEFAULT 'rascunho' NOT NULL,
	"passo_atual" smallint DEFAULT 1 NOT NULL,
	"responsavel_id" uuid,
	"nivel_risco" "nivel_risco" DEFAULT 'baixo' NOT NULL,
	"fatores_risco" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"token_acesso_hash" text NOT NULL,
	"expira_em" timestamp with time zone,
	"submetido_em" timestamp with time zone,
	"aprovado_em" timestamp with time zone,
	"aprovado_por" uuid,
	"motivo_rejeicao" text,
	"pesquisa" "tsvector",
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"apagado_em" timestamp with time zone,
	CONSTRAINT "passo_valido" CHECK ("processo_onboarding"."passo_atual" between 1 and 7)
);
--> statement-breakpoint
CREATE TABLE "area_interesse" (
	"id" uuid PRIMARY KEY NOT NULL,
	"processo_id" uuid NOT NULL,
	"area" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "beneficiario_efetivo" (
	"id" uuid PRIMARY KEY NOT NULL,
	"processo_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"nif" text,
	"percentagem" numeric(5, 2),
	"natureza_controlo" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dados_faturacao" (
	"id" uuid PRIMARY KEY NOT NULL,
	"processo_id" uuid NOT NULL,
	"igual_ao_cliente" boolean DEFAULT false NOT NULL,
	"nome" text NOT NULL,
	"nif" text NOT NULL,
	"morada" text NOT NULL,
	"pais" text NOT NULL,
	"localidade" text NOT NULL,
	"codigo_postal" text NOT NULL,
	"freguesia" text NOT NULL,
	"concelho" text NOT NULL,
	"distrito" text NOT NULL,
	"email" text NOT NULL,
	"ac_igual_ao_cliente" boolean DEFAULT false NOT NULL,
	"ac_nome" text,
	"ac_email" text,
	"ac_telefone" text,
	"iban" text,
	"condicoes_pagamento" text,
	"periodicidade" text,
	"referencia_cliente" text,
	"extra" jsonb DEFAULT '{}'::jsonb,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dados_faturacao_processo_id_unique" UNIQUE("processo_id")
);
--> statement-breakpoint
CREATE TABLE "dados_fiscais" (
	"id" uuid PRIMARY KEY NOT NULL,
	"processo_id" uuid NOT NULL,
	"nif_portugues" boolean DEFAULT true NOT NULL,
	"reside_em_portugal" boolean DEFAULT true NOT NULL,
	"nif" text NOT NULL,
	"doc_tipo" "tipo_doc_id" NOT NULL,
	"doc_numero" text NOT NULL,
	"doc_validade" date NOT NULL,
	"cae" text,
	"codigo_certidao_permanente" text,
	"regime_iva" "regime_iva",
	"extra" jsonb DEFAULT '{}'::jsonb,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dados_fiscais_processo_id_unique" UNIQUE("processo_id")
);
--> statement-breakpoint
CREATE TABLE "dados_identificacao" (
	"id" uuid PRIMARY KEY NOT NULL,
	"processo_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"profissao" text,
	"entidade_patronal" text,
	"data_nascimento" date,
	"natureza_juridica" text,
	"data_constituicao" date,
	"telefone" text NOT NULL,
	"email" text NOT NULL,
	"morada" text NOT NULL,
	"pais" text NOT NULL,
	"localidade" text NOT NULL,
	"codigo_postal" text NOT NULL,
	"freguesia" text NOT NULL,
	"concelho" text NOT NULL,
	"distrito" text NOT NULL,
	"extra" jsonb DEFAULT '{}'::jsonb,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dados_identificacao_processo_id_unique" UNIQUE("processo_id")
);
--> statement-breakpoint
CREATE TABLE "declaracao_ppe" (
	"id" uuid PRIMARY KEY NOT NULL,
	"processo_id" uuid NOT NULL,
	"e_ppe" boolean NOT NULL,
	"ppe_cargo" text,
	"ppe_pais" text,
	"ppe_entidade" text,
	"ppe_inicio" date,
	"ppe_fim" date,
	"e_relacionado_ppe" boolean NOT NULL,
	"relacao_ppe" text,
	"ppe_relacionada_nome" text,
	"ppe_relacionada_cargo" text,
	"ppe_relacionada_pais" text,
	"extra" jsonb DEFAULT '{}'::jsonb,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "declaracao_ppe_processo_id_unique" UNIQUE("processo_id")
);
--> statement-breakpoint
CREATE TABLE "email_newsletter" (
	"id" uuid PRIMARY KEY NOT NULL,
	"processo_id" uuid NOT NULL,
	"email" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fecho_proposta" (
	"id" uuid PRIMARY KEY NOT NULL,
	"processo_id" uuid NOT NULL,
	"declaracao_veracidade" boolean DEFAULT false NOT NULL,
	"servicos_contratados" text,
	"modelo_honorarios" text,
	"valor" numeric(12, 2),
	"moeda" text DEFAULT 'EUR',
	"extra" jsonb DEFAULT '{}'::jsonb,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fecho_proposta_processo_id_unique" UNIQUE("processo_id")
);
--> statement-breakpoint
CREATE TABLE "nacionalidade" (
	"id" uuid PRIMARY KEY NOT NULL,
	"processo_id" uuid NOT NULL,
	"titular" "titular_nacionalidade" NOT NULL,
	"pais" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "preferencias_contacto" (
	"id" uuid PRIMARY KEY NOT NULL,
	"processo_id" uuid NOT NULL,
	"origem_contacto" "origem_contacto",
	"origem_detalhe" text,
	"newsletter" boolean DEFAULT false NOT NULL,
	"convites_iniciativas" boolean DEFAULT false NOT NULL,
	"convites_nome" text,
	"convites_email" text,
	"extra" jsonb DEFAULT '{}'::jsonb,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "preferencias_contacto_processo_id_unique" UNIQUE("processo_id")
);
--> statement-breakpoint
CREATE TABLE "relacao_negocio" (
	"id" uuid PRIMARY KEY NOT NULL,
	"processo_id" uuid NOT NULL,
	"servicos" text NOT NULL,
	"origem_fundos" text NOT NULL,
	"extra" jsonb DEFAULT '{}'::jsonb,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "relacao_negocio_processo_id_unique" UNIQUE("processo_id")
);
--> statement-breakpoint
CREATE TABLE "representante_legal" (
	"id" uuid PRIMARY KEY NOT NULL,
	"processo_id" uuid NOT NULL,
	"e_representante" boolean DEFAULT false NOT NULL,
	"relacao" text,
	"nome" text,
	"data_nascimento" date,
	"profissao" text,
	"telefone" text,
	"email" text,
	"morada" text,
	"pais" text,
	"localidade" text,
	"codigo_postal" text,
	"freguesia" text,
	"concelho" text,
	"distrito" text,
	"nif" text,
	"doc_tipo" "tipo_doc_id",
	"doc_numero" text,
	"doc_validade" date,
	"codigo_rcbe" text,
	"ambito_poderes" text,
	"extra" jsonb DEFAULT '{}'::jsonb,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "representante_legal_processo_id_unique" UNIQUE("processo_id")
);
--> statement-breakpoint
CREATE TABLE "residencia_fiscal_adicional" (
	"id" uuid PRIMARY KEY NOT NULL,
	"processo_id" uuid NOT NULL,
	"jurisdicao" text NOT NULL,
	"tin" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assinatura" (
	"id" uuid PRIMARY KEY NOT NULL,
	"processo_id" uuid NOT NULL,
	"tipo" text DEFAULT 'simples' NOT NULL,
	"imagem_chave" text,
	"hash_documento" text NOT NULL,
	"documento_id" uuid,
	"ip" text NOT NULL,
	"user_agent" text NOT NULL,
	"assinado_em" timestamp with time zone NOT NULL,
	"metadados" jsonb DEFAULT '{}'::jsonb,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assinatura_processo_id_unique" UNIQUE("processo_id")
);
--> statement-breakpoint
CREATE TABLE "documento" (
	"id" uuid PRIMARY KEY NOT NULL,
	"processo_id" uuid NOT NULL,
	"tipo" "tipo_documento" DEFAULT 'outro' NOT NULL,
	"nome_original" text NOT NULL,
	"mime" text NOT NULL,
	"tamanho_bytes" integer NOT NULL,
	"hash_sha256" text NOT NULL,
	"chave_storage" text NOT NULL,
	"validade" date,
	"carregado_por" uuid,
	"extra" jsonb DEFAULT '{}'::jsonb,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"apagado_em" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "consentimento" (
	"id" uuid PRIMARY KEY NOT NULL,
	"processo_id" uuid NOT NULL,
	"finalidade" "finalidade_consentimento" NOT NULL,
	"texto_legal_id" uuid NOT NULL,
	"aceite" boolean NOT NULL,
	"aceite_em" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text NOT NULL,
	"user_agent" text NOT NULL,
	"revogado_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "versao_texto_legal" (
	"id" uuid PRIMARY KEY NOT NULL,
	"chave" text NOT NULL,
	"versao" text NOT NULL,
	"conteudo" text NOT NULL,
	"hash" text NOT NULL,
	"vigente_desde" timestamp with time zone DEFAULT now() NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evento_auditoria" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"processo_id" uuid,
	"ator_id" uuid,
	"acao" text NOT NULL,
	"entidade" text NOT NULL,
	"entidade_id" uuid,
	"valor_anterior" jsonb,
	"valor_novo" jsonb,
	"ip" text,
	"user_agent" text,
	"hash_anterior" text,
	"hash" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contador_referencia" ADD CONSTRAINT "contador_referencia_organizacao_id_organizacao_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacao"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utilizador" ADD CONSTRAINT "utilizador_organizacao_id_organizacao_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacao"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nota" ADD CONSTRAINT "nota_processo_id_processo_onboarding_id_fk" FOREIGN KEY ("processo_id") REFERENCES "public"."processo_onboarding"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nota" ADD CONSTRAINT "nota_autor_id_utilizador_id_fk" FOREIGN KEY ("autor_id") REFERENCES "public"."utilizador"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processo_onboarding" ADD CONSTRAINT "processo_onboarding_organizacao_id_organizacao_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacao"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processo_onboarding" ADD CONSTRAINT "processo_onboarding_responsavel_id_utilizador_id_fk" FOREIGN KEY ("responsavel_id") REFERENCES "public"."utilizador"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processo_onboarding" ADD CONSTRAINT "processo_onboarding_aprovado_por_utilizador_id_fk" FOREIGN KEY ("aprovado_por") REFERENCES "public"."utilizador"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "area_interesse" ADD CONSTRAINT "area_interesse_processo_id_processo_onboarding_id_fk" FOREIGN KEY ("processo_id") REFERENCES "public"."processo_onboarding"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beneficiario_efetivo" ADD CONSTRAINT "beneficiario_efetivo_processo_id_processo_onboarding_id_fk" FOREIGN KEY ("processo_id") REFERENCES "public"."processo_onboarding"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dados_faturacao" ADD CONSTRAINT "dados_faturacao_processo_id_processo_onboarding_id_fk" FOREIGN KEY ("processo_id") REFERENCES "public"."processo_onboarding"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dados_fiscais" ADD CONSTRAINT "dados_fiscais_processo_id_processo_onboarding_id_fk" FOREIGN KEY ("processo_id") REFERENCES "public"."processo_onboarding"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dados_identificacao" ADD CONSTRAINT "dados_identificacao_processo_id_processo_onboarding_id_fk" FOREIGN KEY ("processo_id") REFERENCES "public"."processo_onboarding"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "declaracao_ppe" ADD CONSTRAINT "declaracao_ppe_processo_id_processo_onboarding_id_fk" FOREIGN KEY ("processo_id") REFERENCES "public"."processo_onboarding"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_newsletter" ADD CONSTRAINT "email_newsletter_processo_id_processo_onboarding_id_fk" FOREIGN KEY ("processo_id") REFERENCES "public"."processo_onboarding"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fecho_proposta" ADD CONSTRAINT "fecho_proposta_processo_id_processo_onboarding_id_fk" FOREIGN KEY ("processo_id") REFERENCES "public"."processo_onboarding"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nacionalidade" ADD CONSTRAINT "nacionalidade_processo_id_processo_onboarding_id_fk" FOREIGN KEY ("processo_id") REFERENCES "public"."processo_onboarding"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preferencias_contacto" ADD CONSTRAINT "preferencias_contacto_processo_id_processo_onboarding_id_fk" FOREIGN KEY ("processo_id") REFERENCES "public"."processo_onboarding"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relacao_negocio" ADD CONSTRAINT "relacao_negocio_processo_id_processo_onboarding_id_fk" FOREIGN KEY ("processo_id") REFERENCES "public"."processo_onboarding"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "representante_legal" ADD CONSTRAINT "representante_legal_processo_id_processo_onboarding_id_fk" FOREIGN KEY ("processo_id") REFERENCES "public"."processo_onboarding"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residencia_fiscal_adicional" ADD CONSTRAINT "residencia_fiscal_adicional_processo_id_processo_onboarding_id_fk" FOREIGN KEY ("processo_id") REFERENCES "public"."processo_onboarding"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assinatura" ADD CONSTRAINT "assinatura_processo_id_processo_onboarding_id_fk" FOREIGN KEY ("processo_id") REFERENCES "public"."processo_onboarding"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assinatura" ADD CONSTRAINT "assinatura_documento_id_documento_id_fk" FOREIGN KEY ("documento_id") REFERENCES "public"."documento"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documento" ADD CONSTRAINT "documento_processo_id_processo_onboarding_id_fk" FOREIGN KEY ("processo_id") REFERENCES "public"."processo_onboarding"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documento" ADD CONSTRAINT "documento_carregado_por_utilizador_id_fk" FOREIGN KEY ("carregado_por") REFERENCES "public"."utilizador"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consentimento" ADD CONSTRAINT "consentimento_processo_id_processo_onboarding_id_fk" FOREIGN KEY ("processo_id") REFERENCES "public"."processo_onboarding"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consentimento" ADD CONSTRAINT "consentimento_texto_legal_id_versao_texto_legal_id_fk" FOREIGN KEY ("texto_legal_id") REFERENCES "public"."versao_texto_legal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contador_org_ano" ON "contador_referencia" USING btree ("organizacao_id","ano");--> statement-breakpoint
CREATE UNIQUE INDEX "utilizador_email_org" ON "utilizador" USING btree ("organizacao_id","email");--> statement-breakpoint
CREATE INDEX "utilizador_org" ON "utilizador" USING btree ("organizacao_id");--> statement-breakpoint
CREATE INDEX "nota_processo" ON "nota" USING btree ("processo_id","criado_em");--> statement-breakpoint
CREATE UNIQUE INDEX "processo_referencia_org" ON "processo_onboarding" USING btree ("organizacao_id","referencia");--> statement-breakpoint
CREATE UNIQUE INDEX "processo_token" ON "processo_onboarding" USING btree ("token_acesso_hash");--> statement-breakpoint
CREATE INDEX "processo_estado" ON "processo_onboarding" USING btree ("organizacao_id","estado");--> statement-breakpoint
CREATE INDEX "processo_risco" ON "processo_onboarding" USING btree ("organizacao_id","nivel_risco");--> statement-breakpoint
CREATE INDEX "processo_responsavel" ON "processo_onboarding" USING btree ("responsavel_id");--> statement-breakpoint
CREATE INDEX "processo_pesquisa" ON "processo_onboarding" USING gin ("pesquisa");--> statement-breakpoint
CREATE UNIQUE INDEX "area_unica" ON "area_interesse" USING btree ("processo_id","area");--> statement-breakpoint
CREATE INDEX "beneficiario_processo" ON "beneficiario_efetivo" USING btree ("processo_id");--> statement-breakpoint
CREATE INDEX "beneficiario_nif" ON "beneficiario_efetivo" USING btree ("nif");--> statement-breakpoint
CREATE INDEX "fiscais_nif" ON "dados_fiscais" USING btree ("nif");--> statement-breakpoint
CREATE INDEX "fiscais_doc_validade" ON "dados_fiscais" USING btree ("doc_validade");--> statement-breakpoint
CREATE INDEX "identificacao_nome" ON "dados_identificacao" USING btree ("nome");--> statement-breakpoint
CREATE UNIQUE INDEX "newsletter_email_unico" ON "email_newsletter" USING btree ("processo_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "nacionalidade_unica" ON "nacionalidade" USING btree ("processo_id","titular","pais");--> statement-breakpoint
CREATE INDEX "representante_nif" ON "representante_legal" USING btree ("nif");--> statement-breakpoint
CREATE UNIQUE INDEX "residencia_unica" ON "residencia_fiscal_adicional" USING btree ("processo_id","jurisdicao");--> statement-breakpoint
CREATE INDEX "documento_processo" ON "documento" USING btree ("processo_id");--> statement-breakpoint
CREATE INDEX "documento_validade" ON "documento" USING btree ("validade");--> statement-breakpoint
CREATE UNIQUE INDEX "consentimento_unico" ON "consentimento" USING btree ("processo_id","finalidade","texto_legal_id");--> statement-breakpoint
CREATE INDEX "consentimento_processo" ON "consentimento" USING btree ("processo_id");--> statement-breakpoint
CREATE UNIQUE INDEX "texto_chave_versao" ON "versao_texto_legal" USING btree ("chave","versao");--> statement-breakpoint
CREATE INDEX "texto_chave" ON "versao_texto_legal" USING btree ("chave","vigente_desde");--> statement-breakpoint
CREATE INDEX "auditoria_org" ON "evento_auditoria" USING btree ("organizacao_id","criado_em");--> statement-breakpoint
CREATE INDEX "auditoria_processo" ON "evento_auditoria" USING btree ("processo_id","criado_em");--> statement-breakpoint
CREATE INDEX "auditoria_ator" ON "evento_auditoria" USING btree ("ator_id","criado_em");--> statement-breakpoint
CREATE INDEX "auditoria_acao" ON "evento_auditoria" USING btree ("acao");