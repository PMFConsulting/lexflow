-- O armazenamento passa a ter um destino só: o servidor da sociedade, por SFTP.
-- Sai o OneDrive, e com ele a coluna que escolhia entre destinos.
--
-- A ordem importa. Uma linha que estivesse em 'onedrive' tem credenciais do
-- Microsoft Graph gravadas em `parametros`, e essas credenciais deixam de
-- servir para alguma coisa: lidas como parâmetros de servidor não têm host
-- nem utilizador e rebentam à entrada. Ficam a null e a linha desligada, que
-- é o estado "por configurar" — e é exatamente o que o ecrã de configuração
-- diz a quem lá chegar. Apagá-las é também o que o RGPD pede de um segredo
-- que já não tem finalidade.
UPDATE "armazenamento_sociedade"
SET "parametros" = NULL, "ativo" = false, "ultimo_erro" = NULL
WHERE "tipo" = 'onedrive';
--> statement-breakpoint
ALTER TABLE "armazenamento_sociedade" DROP COLUMN "tipo";--> statement-breakpoint
DROP TYPE "public"."tipo_armazenamento";
