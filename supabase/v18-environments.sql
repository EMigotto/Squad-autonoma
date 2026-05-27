-- ============================================================
-- Migration v18: Aplicações (config) + Ambientes (branch por aplicação)
-- ============================================================
-- Reestrutura para o modelo Time → Aplicações + Ambientes:
--  - a config de aplicação migra do "Time" (projects) para a Aplicação
--    (project_repositories): tipo (nova/existente), natureza, stack, instruções.
--  - Ambientes mapeiam UMA branch por Aplicação (Dev/Homolog/Prod).
--  - cada feature passa a ter environment_id (além do repository_id que já existe).
-- Defensiva e idempotente.
-- ============================================================

-- Garante a tabela de aplicações (caso v11/v15 não tenham rodado)
CREATE TABLE IF NOT EXISTS project_repositories (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    github_repo         TEXT NOT NULL,
    label               TEXT,
    default_base_branch TEXT NOT NULL DEFAULT 'main',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --- Config de aplicação migra para a Aplicação (project_repositories) ---
ALTER TABLE project_repositories ADD COLUMN IF NOT EXISTS app_type TEXT DEFAULT 'new';        -- new | existing
ALTER TABLE project_repositories ADD COLUMN IF NOT EXISTS app_kind TEXT;                       -- app | microservice | ...
ALTER TABLE project_repositories ADD COLUMN IF NOT EXISTS tech_stack TEXT;
ALTER TABLE project_repositories ADD COLUMN IF NOT EXISTS instructions_path TEXT DEFAULT 'CLAUDE.md';
ALTER TABLE project_repositories ADD COLUMN IF NOT EXISTS depends_on TEXT;
ALTER TABLE project_repositories ADD COLUMN IF NOT EXISTS description TEXT;

-- Backfill: copia a config que hoje está no projeto para a aplicação correspondente
DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN SELECT id, github_repo, app_type, app_kind, tech_stack, instructions_path FROM projects LOOP
    UPDATE project_repositories r
    SET app_type          = COALESCE(r.app_type, p.app_type, 'new'),
        app_kind          = COALESCE(r.app_kind, p.app_kind),
        tech_stack        = COALESCE(r.tech_stack, p.tech_stack),
        instructions_path = COALESCE(r.instructions_path, p.instructions_path, 'CLAUDE.md')
    WHERE r.project_id = p.id;
  END LOOP;
END $$;

-- --- Ambientes (por Time/projeto) ---
CREATE TABLE IF NOT EXISTS environments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    is_default  BOOLEAN DEFAULT false,
    sort_order  INT DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_environments_project ON environments(project_id);

-- Mapeamento: uma branch por Aplicação dentro de cada Ambiente
CREATE TABLE IF NOT EXISTS environment_branches (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
    repository_id  UUID NOT NULL REFERENCES project_repositories(id) ON DELETE CASCADE,
    branch         TEXT NOT NULL DEFAULT 'main',
    UNIQUE (environment_id, repository_id)
);

-- feature ganha o ambiente
ALTER TABLE features ADD COLUMN IF NOT EXISTS environment_id UUID REFERENCES environments(id);

-- RLS
ALTER TABLE environments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read environments" ON environments;
CREATE POLICY "auth read environments" ON environments FOR SELECT TO authenticated USING (true);
ALTER TABLE environment_branches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read env branches" ON environment_branches;
CREATE POLICY "auth read env branches" ON environment_branches FOR SELECT TO authenticated USING (true);

-- Seed: um ambiente default "Produção" por projeto, mapeando cada aplicação à sua branch base
DO $$
DECLARE
  proj RECORD;
  env_id UUID;
  repo RECORD;
BEGIN
  FOR proj IN SELECT id FROM projects LOOP
    SELECT id INTO env_id FROM environments WHERE project_id = proj.id AND is_default LIMIT 1;
    IF env_id IS NULL THEN
      INSERT INTO environments (project_id, name, is_default, sort_order)
      VALUES (proj.id, 'Produção', true, 100) RETURNING id INTO env_id;
    END IF;
    FOR repo IN SELECT id, default_base_branch FROM project_repositories WHERE project_id = proj.id LOOP
      INSERT INTO environment_branches (environment_id, repository_id, branch)
      VALUES (env_id, repo.id, COALESCE(repo.default_base_branch, 'main'))
      ON CONFLICT (environment_id, repository_id) DO NOTHING;
    END LOOP;
    UPDATE features SET environment_id = env_id WHERE project_id = proj.id AND environment_id IS NULL;
  END LOOP;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE environments;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE environment_branches;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
