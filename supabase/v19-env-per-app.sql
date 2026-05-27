-- ============================================================
-- Migration v19: Ambientes passam a pertencer à APLICAÇÃO
-- ============================================================
-- Antes: ambiente era do Time e mapeava 1 branch por aplicação.
-- Agora: cada Aplicação (project_repositories) tem seus próprios ambientes,
--        e cada ambiente É uma branch (nome + branch) daquela aplicação.
-- Defensiva e idempotente.
-- ============================================================

-- Garante a coluna features.repository_id (caso a v11 não tenha sido aplicada)
ALTER TABLE features ADD COLUMN IF NOT EXISTS repository_id UUID REFERENCES project_repositories(id);

-- Backfill: associa cada feature à aplicação correspondente (project_id + github_repo)
UPDATE features f
SET repository_id = (
  SELECT r.id FROM project_repositories r
  WHERE r.project_id = f.project_id
    AND r.github_repo = f.github_repo
  LIMIT 1
)
WHERE f.repository_id IS NULL
  AND f.project_id IS NOT NULL
  AND f.github_repo IS NOT NULL;

ALTER TABLE environments ADD COLUMN IF NOT EXISTS repository_id UUID REFERENCES project_repositories(id) ON DELETE CASCADE;
ALTER TABLE environments ADD COLUMN IF NOT EXISTS branch TEXT;

-- Backfill: explode o mapeamento antigo (environment_branches) em ambientes por aplicação
DO $$
DECLARE eb RECORD;
BEGIN
  IF to_regclass('public.environment_branches') IS NOT NULL THEN
    FOR eb IN SELECT environment_id, repository_id, branch FROM environment_branches LOOP
      UPDATE environments e
        SET repository_id = eb.repository_id, branch = eb.branch
        WHERE e.id = eb.environment_id AND e.repository_id IS NULL;
      IF NOT FOUND THEN
        INSERT INTO environments (project_id, repository_id, name, branch, is_default, sort_order)
        SELECT project_id, eb.repository_id, name, eb.branch, is_default, sort_order
        FROM environments WHERE id = eb.environment_id;
      END IF;
    END LOOP;
  END IF;
END $$;

-- Garante ao menos um ambiente "Produção" por aplicação (→ branch base)
DO $$
DECLARE app RECORD;
BEGIN
  FOR app IN SELECT id, project_id, default_base_branch FROM project_repositories LOOP
    IF NOT EXISTS (SELECT 1 FROM environments WHERE repository_id = app.id) THEN
      INSERT INTO environments (project_id, repository_id, name, branch, is_default, sort_order)
      VALUES (app.project_id, app.id, 'Produção', COALESCE(app.default_base_branch, 'main'), true, 100);
    END IF;
  END LOOP;
END $$;

-- Repoint features para o ambiente da sua aplicação (prefere o default)
DO $$
DECLARE f RECORD; env_id UUID;
BEGIN
  FOR f IN SELECT id, repository_id FROM features WHERE repository_id IS NOT NULL LOOP
    SELECT id INTO env_id FROM environments
      WHERE repository_id = f.repository_id
      ORDER BY is_default DESC, sort_order ASC LIMIT 1;
    IF env_id IS NOT NULL THEN
      UPDATE features SET environment_id = env_id WHERE id = f.id;
    END IF;
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_environments_repo ON environments(repository_id);
