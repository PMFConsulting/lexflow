-- Três níveis de papel e um utilizador sem sociedade.
--
-- O que muda: `papel_utilizador` deixa de ter os quatro cargos de escritório
-- (`admin`, `socio`, `advogado`, `assistente`) e passa a ter os três níveis da
-- plataforma (`super_admin`, `society_admin`, `utilizador`); `organizacao_id`
-- em `utilizador` passa a anulável, porque o dono da plataforma não pertence a
-- sociedade nenhuma; e entram as restrições que essas duas coisas obrigam a ter.
--
-- ────────────────────────────────────────────────────────────────────────────
-- Porquê à mão, e não o que o `db:generate` propôs
--
-- O drizzle-kit propôs converter a coluna para `text`, largar o tipo, criar o
-- novo e reconverter com `USING "papel"::"papel_utilizador"`. Essa última linha
-- **rebenta em produção**: as três contas que lá estão têm `papel = 'admin'`, e
-- 'admin' não é um valor do tipo novo. O `USING` tem de traduzir, não de
-- reinterpretar. É o que a `CASE` abaixo faz, e é a razão inteira deste
-- ficheiro ser escrito e não gerado.
--
-- O mapeamento, e o sentido dele:
--   admin                          → society_admin
--   socio | advogado | assistente  → utilizador
--
-- `admin` vai para `society_admin` e não para `super_admin` porque as três
-- contas de produção são a equipa da sociedade, não os donos da plataforma —
-- promovê-las dava a três pessoas a lista de todas as sociedades do sistema.
-- Os outros três descem todos para o mesmo nível: `assistente` ganha o que não
-- tinha (ver PPE, aprovar), o que é preferível ao simétrico. Tirar a aprovação
-- a um `advogado` numa migração é uma capacidade que desaparece sem aviso e só
-- se descobre no dia em que ele precisa dela.
--
-- ────────────────────────────────────────────────────────────────────────────
-- Idempotência
--
-- Tudo aqui pode correr duas vezes. O bloco do enum é guardado pela pergunta
-- "o tipo ainda tem o valor 'admin'?" — se não tem, já foi convertido e não há
-- nada a fazer; os índices e a restrição vão com a verificação da existência
-- pelo nome. Uma migração de tipos a meio caminho é o pior estado possível
-- desta tabela (o login resolve por `auth_user_id` e não há coluna de papel
-- válida para ler), por isso a conversão inteira vive num só bloco: ou passa
-- toda, ou o Postgres desfaz tudo.
--
-- **Não** se repetem aqui as instruções da `0015`. O `db:generate` voltou a
-- propô-las porque a `0015` foi escrita à mão e nunca teve `meta/0015_snapshot.json`
-- — o diff foi feito contra a `0014`. O `0016_snapshot.json` fecha esse buraco
-- de vez (contém já tudo), mas repetir o SQL partia as bases onde a `0015` já
-- correu e era redundante nas outras, onde ela corre à mesma, por estar no
-- journal.

/* ------------------------------------------------------- o tipo e os valores */

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'papel_utilizador'
      AND e.enumlabel = 'admin'
  ) THEN
    -- Renomear em vez de largar: `utilizador.papel` ainda depende dele, e um
    -- DROP com dependentes não passa. O tipo antigo sai no fim, já sem ninguém
    -- a apontar-lhe.
    ALTER TYPE "public"."papel_utilizador" RENAME TO "papel_utilizador_antigo";

    CREATE TYPE "public"."papel_utilizador" AS ENUM ('super_admin', 'society_admin', 'utilizador');

    -- O DEFAULT sai primeiro: é `'assistente'::papel_utilizador_antigo`, e uma
    -- coluna não muda de tipo com um valor por omissão do tipo anterior colado
    -- a ela.
    ALTER TABLE "utilizador" ALTER COLUMN "papel" DROP DEFAULT;

    ALTER TABLE "utilizador"
      ALTER COLUMN "papel" TYPE "public"."papel_utilizador"
      USING (
        CASE "papel"::text
          WHEN 'admin' THEN 'society_admin'
          ELSE 'utilizador'
        END
      )::"public"."papel_utilizador";

    ALTER TABLE "utilizador" ALTER COLUMN "papel" SET DEFAULT 'utilizador'::"public"."papel_utilizador";

    DROP TYPE "public"."papel_utilizador_antigo";
  END IF;
END $$;--> statement-breakpoint

/* ------------------------------------ o super_admin não pertence a sociedade */

-- Sem dono de nenhuma sociedade não há como representar quem é dono da
-- plataforma. Correr isto duas vezes não faz nada.
ALTER TABLE "utilizador" ALTER COLUMN "organizacao_id" DROP NOT NULL;--> statement-breakpoint

-- O índice único que já existia é sobre (organizacao_id, email), e no Postgres
-- dois NULL não colidem: sem este parcial, dois `super_admin` com o mesmo
-- endereço entravam os dois e `sessaoAtual()` — que resolve por `auth_user_id`
-- com `limit(1)` — escolhia um deles ao acaso.
CREATE UNIQUE INDEX IF NOT EXISTS "utilizador_email_plataforma"
  ON "utilizador" USING btree ("email")
  WHERE "utilizador"."organizacao_id" is null;--> statement-breakpoint

-- A regra de negócio no sítio onde não se contorna. O Server Action que cria
-- contas valida o mesmo — mas valida o caminho da interface, e este fecha os
-- outros: o `scripts/criar_utilizador.mjs`, um UPDATE à mão, uma seed. Um
-- `society_admin` sem sociedade entra e não vê processo nenhum, sem erro
-- nenhum a explicar porquê.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'utilizador_org_por_papel'
      AND conrelid = 'public.utilizador'::regclass
  ) THEN
    ALTER TABLE "utilizador" ADD CONSTRAINT "utilizador_org_por_papel" CHECK (("utilizador"."papel" = 'super_admin' and "utilizador"."organizacao_id" is null)
          or ("utilizador"."papel" <> 'super_admin' and "utilizador"."organizacao_id" is not null));
  END IF;
END $$;--> statement-breakpoint

/* ----------------------------------------- sociedades criadas pela interface */

-- Até aqui só havia uma sociedade e ela vinha de uma seed: nada podia colidir
-- com nada. A partir do portal do `super_admin` são criadas à mão, e o prefixo
-- é a primeira sílaba de todas as referências de processo (`PMF-2026-0142`) —
-- duas sociedades com o mesmo prefixo produzem dossiers que se leem como sendo
-- da mesma casa, em emails, em PDFs de arquivo e em assuntos de aviso interno.
--
-- Parciais em `apagado_em is null` nas duas: uma sociedade apagada não pode
-- ficar a reservar o prefixo dela para sempre.
CREATE UNIQUE INDEX IF NOT EXISTS "organizacao_prefixo"
  ON "organizacao" USING btree ("prefixo_referencia")
  WHERE "organizacao"."apagado_em" is null;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "organizacao_nif"
  ON "organizacao" USING btree ("nif")
  WHERE "organizacao"."apagado_em" is null;
