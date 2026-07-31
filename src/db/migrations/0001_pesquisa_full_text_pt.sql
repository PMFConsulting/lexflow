-- Pesquisa global por nome, NIF e referência, em português e sem sensibilidade
-- a acentos (§6 do brief).
--
-- `unaccent` não é immutable, por isso não pode entrar numa coluna gerada nem
-- num índice de expressão. O caminho correto é uma configuração de pesquisa
-- própria que já aplica unaccent no mapeamento, e uma coluna mantida por
-- trigger — as fontes estão noutras tabelas, o que também exclui GENERATED.

CREATE EXTENSION IF NOT EXISTS unaccent;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'pt_unaccent') THEN
    CREATE TEXT SEARCH CONFIGURATION pt_unaccent (COPY = portuguese);
    ALTER TEXT SEARCH CONFIGURATION pt_unaccent
      ALTER MAPPING FOR hword, hword_part, word
      WITH unaccent, portuguese_stem;
  END IF;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION atualizar_pesquisa_processo(p_processo_id uuid)
RETURNS void AS $$
BEGIN
  UPDATE processo_onboarding p
  SET pesquisa =
        setweight(to_tsvector('pt_unaccent', coalesce(p.referencia, '')), 'A') ||
        setweight(to_tsvector('pt_unaccent', coalesce(i.nome, '')), 'A') ||
        setweight(to_tsvector('pt_unaccent', coalesce(f.nif, '')), 'B') ||
        setweight(to_tsvector('pt_unaccent', coalesce(r.nome, '')), 'C')
  FROM processo_onboarding base
  LEFT JOIN dados_identificacao i ON i.processo_id = base.id
  LEFT JOIN dados_fiscais f       ON f.processo_id = base.id
  LEFT JOIN representante_legal r ON r.processo_id = base.id
  WHERE p.id = base.id AND p.id = p_processo_id;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION trg_atualizar_pesquisa()
RETURNS trigger AS $$
DECLARE
  alvo uuid;
BEGIN
  IF TG_TABLE_NAME = 'processo_onboarding' THEN
    alvo := NEW.id;
  ELSE
    alvo := NEW.processo_id;
  END IF;
  PERFORM atualizar_pesquisa_processo(alvo);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER pesquisa_processo
  AFTER INSERT OR UPDATE OF referencia ON processo_onboarding
  FOR EACH ROW EXECUTE FUNCTION trg_atualizar_pesquisa();
--> statement-breakpoint
CREATE TRIGGER pesquisa_identificacao
  AFTER INSERT OR UPDATE OF nome ON dados_identificacao
  FOR EACH ROW EXECUTE FUNCTION trg_atualizar_pesquisa();
--> statement-breakpoint
CREATE TRIGGER pesquisa_fiscais
  AFTER INSERT OR UPDATE OF nif ON dados_fiscais
  FOR EACH ROW EXECUTE FUNCTION trg_atualizar_pesquisa();
--> statement-breakpoint
CREATE TRIGGER pesquisa_representante
  AFTER INSERT OR UPDATE OF nome ON representante_legal
  FOR EACH ROW EXECUTE FUNCTION trg_atualizar_pesquisa();
