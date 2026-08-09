-- Dados de abertura do processo: o que a sociedade sabe do cliente no momento
-- em que cria o dossier, antes de o cliente preencher fosse o que for.
--
-- Até aqui o nome e o email escritos na janela "Novo processo" não iam a lado
-- nenhum — serviam a saudação de um email que a D33 entretanto tirou, e o
-- processo nascia sem uma única pista de quem era. Numa pessoa coletiva isso
-- passa a ser inaceitável: o NIPC e a denominação são obrigatórios à abertura.
--
-- Anuláveis, e à parte de `dados_identificacao` / `dados_fiscais` de propósito.
-- O que a sociedade escreveu ao abrir e o que o cliente declarou no formulário
-- são duas afirmações diferentes, com autores diferentes, e não podem ficar
-- indistinguíveis na mesma coluna. Um processo antigo fica com os três a NULL,
-- que é a verdade sobre ele.
ALTER TABLE "processo_onboarding" ADD COLUMN "nome_cliente" text;--> statement-breakpoint
ALTER TABLE "processo_onboarding" ADD COLUMN "nif_cliente" text;--> statement-breakpoint
ALTER TABLE "processo_onboarding" ADD COLUMN "email_cliente" text;
