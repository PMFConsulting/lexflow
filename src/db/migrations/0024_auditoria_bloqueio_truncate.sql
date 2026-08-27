-- Bloqueio definitivo de TRUNCATE em evento_auditoria (camada de base de dados).
-- A imutabilidade do registo de auditoria exige que nem o owner da app nem scripts
-- em runtime possam limpar a tabela via TRUNCATE.

CREATE OR REPLACE FUNCTION impedir_truncate_evento_auditoria()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'A tabela evento_auditoria é imutável e não pode ser truncada.';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS trigger_impedir_truncate_evento_auditoria ON evento_auditoria;
--> statement-breakpoint
CREATE TRIGGER trigger_impedir_truncate_evento_auditoria
  BEFORE TRUNCATE ON evento_auditoria
  FOR EACH STATEMENT
  EXECUTE FUNCTION impedir_truncate_evento_auditoria();
--> statement-breakpoint

REVOKE TRUNCATE ON evento_auditoria FROM PUBLIC;
--> statement-breakpoint

-- Atualiza índice único de consentimento para permitir nova concessão após revogação (Finding 4)
DROP INDEX IF EXISTS "consentimento_unico";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "consentimento_unico" ON "consentimento" USING btree ("processo_id", "finalidade", "texto_legal_id") WHERE "revogado_em" IS NULL;
