-- `evento_auditoria` é append-only. A imutabilidade não é convenção de código:
-- está garantida aqui, na base de dados.
--
-- Duas camadas de propósito:
--   1. REVOKE — a defesa a sério. O papel da aplicação deixa de ter o direito.
--   2. RULE ... DO INSTEAD NOTHING — a rede de segurança para o caso de alguém
--      correr uma migração ou um script com um papel privilegiado.
--
-- Nota operacional: o owner da tabela contorna sempre o REVOKE. Se o utilizador
-- da aplicação for também o owner (é o caso por omissão no Supabase), só as
-- RULE protegem. Criar um papel `app_user` separado do owner é o passo que
-- fecha isto — fica registado para a passagem a produção.

CREATE RULE evento_auditoria_sem_update AS
  ON UPDATE TO evento_auditoria DO INSTEAD NOTHING;
--> statement-breakpoint
CREATE RULE evento_auditoria_sem_delete AS
  ON DELETE TO evento_auditoria DO INSTEAD NOTHING;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON evento_auditoria FROM app_user;
  END IF;
END
$$;
