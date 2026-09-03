-- Consentimento de privacidade no registo da sociedade (RGPD, art. 6.º/7.º).
--
-- O passo final do onboarding da sociedade passou a exigir uma declaração de
-- consentimento antes da submissão. Fica gravado apenas o momento em que foi
-- dada (timestamp) e a versão dos documentos que a pessoa viu — o próprio
-- valor da caixa é um `z.literal(true)` no schema do passo, por isso um "não"
-- nunca chega a ser escrito como dado. A versão é o que liga a concessão ao
-- texto exato da Política de Privacidade e dos Termos de Utilização em vigor
-- nesse dia (mesma regra de prova da D3).
--
-- Aditivo e anulável: linhas já existentes (sociedades em registo, ou já
-- submetidas) não ficam com consentimento, e nada do que existia muda.
--> statement-breakpoint
ALTER TABLE "onboarding_sociedade" ADD COLUMN "consentimento_privacidade_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "onboarding_sociedade" ADD COLUMN "consentimento_privacidade_versao" text;
