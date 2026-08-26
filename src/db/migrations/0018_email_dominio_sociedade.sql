-- Cada sociedade envia do seu próprio domínio.
--
-- Até aqui os quatro canais (Resend, Mailjet, Brevo, SMTP próprio) partilhavam
-- um remetente só, o `EMAIL_REMETENTE` do ambiente. Com uma sociedade isso
-- passa despercebido; com duas, o cliente da segunda recebe um pedido de dados
-- pessoais assinado com o domínio da primeira — e a resposta certa dele é não
-- responder.
--
-- Tudo aditivo e tudo anulável: a ausência das cinco colunas significa uma coisa
-- só, «esta sociedade usa o remetente global», que é exatamente o que as
-- sociedades já existentes fazem hoje. Nenhuma linha precisa de ser preenchida
-- para a instalação continuar a enviar como enviava.
--
-- `dominio_estado` é `text` e não um enum do Postgres: os valores são da Resend
-- (`not_started`, `pending`, `verified`, `failed`, `temporary_failure`) e mudam
-- quando ela quiser. Um enum obrigava a uma migração no dia em que aparecesse um
-- estado novo, e entretanto a escrita rebentava — o que transformava uma
-- verificação de DNS numa falha da plataforma.
--
-- `IF NOT EXISTS` nas cinco: esta migração pode correr duas vezes sem consequência.

ALTER TABLE "organizacao" ADD COLUMN IF NOT EXISTS "email_remetente" text;--> statement-breakpoint
ALTER TABLE "organizacao" ADD COLUMN IF NOT EXISTS "dominio_email" text;--> statement-breakpoint
ALTER TABLE "organizacao" ADD COLUMN IF NOT EXISTS "dominio_resend_id" text;--> statement-breakpoint
ALTER TABLE "organizacao" ADD COLUMN IF NOT EXISTS "dominio_verificado_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizacao" ADD COLUMN IF NOT EXISTS "dominio_estado" text;
