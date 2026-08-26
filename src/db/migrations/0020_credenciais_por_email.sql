-- As credenciais de uma conta criada por um administrador passam a ir por email
-- para a pessoa, e a palavra-passe que vai é temporária.
--
-- Duas adições, e nada de existente é alterado.
--
-- 1. `utilizador.deve_redefinir_password` — enquanto estiver a `true`,
--    `exigirSessao()` (src/lib/sessao.ts) não deixa a pessoa passar do ecrã de
--    definição de palavra-passe. A coluna vive aqui e não na `user` do Better
--    Auth: essa tabela não leva colunas de negócio (D2).
--
--    O `DEFAULT false` é uma decisão e não uma distração. Um `DEFAULT true`
--    marcava **todas** as contas que já existem, e obrigava pessoas que
--    escolheram a sua palavra-passe — e não têm nada a corrigir — a trocá-la no
--    login seguinte, sem aviso nenhum. Quem nasce com uma palavra-passe gerada
--    é marcado explicitamente por `criarConta`, no sítio onde ela é gerada.
--
-- 2. `template_email.credenciais_acesso` — o email que leva as credenciais. É o
--    único desta lista que transporta uma palavra-passe, e o corpo continua a
--    não ser guardado em lado nenhum: o `email_log` regista assunto e
--    destinatário, nunca o corpo (D34).
--
-- `IF NOT EXISTS` nas duas para garantir idempotência.

ALTER TABLE "utilizador" ADD COLUMN IF NOT EXISTS "deve_redefinir_password" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TYPE "public"."template_email" ADD VALUE IF NOT EXISTS 'credenciais_acesso';
