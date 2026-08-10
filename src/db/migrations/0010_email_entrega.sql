-- Rastreio de entrega no diário de emails.
--
-- Até aqui `estado = 'enviado'` queria dizer "o fornecedor respondeu 200", e a
-- listagem apresentava isso como se fosse "o cliente recebeu". Num teste de
-- vinte empresas uma das mensagens ficou em `enviado` e nunca chegou à caixa —
-- sem erro no servidor, sem nada que distinguisse essa linha das dezanove que
-- correram bem. É essa distinção que estas colunas passam a suportar.
--
-- Os valores novos vão para o fim do enum, que é onde o `ALTER TYPE ADD VALUE`
-- os põe: o array do Drizzle em `db/schema/enums.ts` está pela mesma ordem, e
-- divergirem faz o `db:generate` seguinte propor uma migração a corrigir o que
-- não está errado. O `IF NOT EXISTS` é para a migração poder ser reaplicada a
-- uma base que já a tenha levado à mão.
ALTER TYPE "public"."estado_email" ADD VALUE IF NOT EXISTS 'entregue';--> statement-breakpoint
ALTER TYPE "public"."estado_email" ADD VALUE IF NOT EXISTS 'devolvido';--> statement-breakpoint
ALTER TYPE "public"."estado_email" ADD VALUE IF NOT EXISTS 'queixa';--> statement-breakpoint
-- Qual dos dois canais aceitou. Não é diagnóstico de luxo: é o que decide a
-- quem se pergunta pelo desfecho — o id do Brevo não existe no Resend.
CREATE TYPE "public"."canal_email" AS ENUM('brevo', 'resend');--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN "canal" "canal_email";--> statement-breakpoint
-- O `id` do Resend / `messageId` do Brevo. Não é segredo (não abre dossier
-- nenhum, ao contrário do token — ver D4) e é a única forma de voltar a
-- perguntar ao fornecedor o que fez à mensagem.
ALTER TABLE "email_log" ADD COLUMN "mensagem_id" text;--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN "verificado_em" timestamp with time zone;--> statement-breakpoint
-- Para chegar à linha a partir de um id do painel do fornecedor — e, um dia, a
-- partir do corpo de um webhook.
CREATE INDEX "email_log_mensagem" ON "email_log" USING btree ("mensagem_id");
