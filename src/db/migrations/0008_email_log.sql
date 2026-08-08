-- Diário do canal de email: uma linha por tentativa de envio.
--
-- Não é auditoria e não a substitui. `evento_auditoria` continua a registar o
-- que o envio de um link significa para o processo (`link.enviado` /
-- `link.envio_falhou`), append-only e com cadeia de hashes. Isto é o diário
-- técnico do canal — responde a "o cliente recebeu alguma coisa?" e "porque é
-- que não recebeu" — e pode ser truncado sem consequência legal. Daí não levar
-- nem RULE nem REVOKE, ao contrário da migração 0002.
CREATE TYPE "public"."template_email" AS ENUM('registo', 'confirmacao_rececao', 'boas_vindas', 'notificacao_backoffice');--> statement-breakpoint
CREATE TYPE "public"."estado_email" AS ENUM('enviado', 'erro');--> statement-breakpoint
CREATE TABLE "email_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizacao_id" uuid,
	"processo_id" uuid,
	"para" text NOT NULL,
	"assunto" text NOT NULL,
	"template" "template_email" NOT NULL,
	"token_hash" text,
	"estado" "estado_email" NOT NULL,
	"erro" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
-- `set null` nos dois, e não `cascade`: apagar um processo não pode apagar a
-- prova de que se escreveu ao cliente. A linha fica, sem processo.
ALTER TABLE "email_log" ADD CONSTRAINT "email_log_organizacao_id_organizacao_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacao"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_log" ADD CONSTRAINT "email_log_processo_id_processo_onboarding_id_fk" FOREIGN KEY ("processo_id") REFERENCES "public"."processo_onboarding"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- A listagem abre ordenada por data decrescente e filtra por estado; o detalhe
-- de um processo procura os emails dele.
CREATE INDEX "email_log_criado" ON "email_log" USING btree ("criado_em");--> statement-breakpoint
CREATE INDEX "email_log_processo" ON "email_log" USING btree ("processo_id");--> statement-breakpoint
CREATE INDEX "email_log_estado" ON "email_log" USING btree ("estado");
