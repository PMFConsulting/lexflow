-- Fluxo de aprovação: um processo submetido pelo cliente já não passa direto a
-- `submetido` como estado final da POC — fica em `aguardar_aprovacao` até um
-- sócio ou advogado o aprovar ou rejeitar no back-office. `submetido` fica no
-- tipo (registos antigos e o próprio `submetidoEm` continuam a existir), só
-- deixa de ser o estado gravado por `submeter()`.
--
-- O `ADD VALUE ... BEFORE 'em_revisao'` põe o valor logo a seguir a
-- `submetido`, que é onde ele entra no fluxo. O array do Drizzle em
-- `db/schema/enums.ts` segue a mesma ordem — divergirem faz o `db:generate`
-- seguinte propor uma migração a corrigir o que não está errado.
ALTER TYPE "public"."estado_processo" ADD VALUE IF NOT EXISTS 'aguardar_aprovacao' BEFORE 'em_revisao';--> statement-breakpoint

-- Quinto valor do diário de emails: o email de rejeição enviado ao cliente
-- quando um processo é recusado no back-office.
ALTER TYPE "public"."template_email" ADD VALUE IF NOT EXISTS 'rejeicao';--> statement-breakpoint

-- Aceitação da proposta de honorários, separada da dos T&C (`tc_aceitacao`):
-- são dois documentos distintos, e o cliente passa a ter de ler e aceitar os
-- dois, não um só a valer pelos dois. Rascunhos antigos ficam com `false`, que
-- é a verdade sobre eles — ninguém aceitou a proposta separadamente até aqui.
ALTER TABLE "fecho_proposta" ADD COLUMN "proposta_aceitacao" boolean DEFAULT false NOT NULL;
