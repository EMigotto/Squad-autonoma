-- ============================================================
-- Migration v15: Revisão reforçada + dependências entre repositórios
-- ============================================================
-- DEFENSIVA: garante que project_repositories exista (caso a v11 não tenha
-- sido aplicada) antes de alterá-la. Idempotente — pode rodar com segurança
-- independentemente da ordem.
-- ============================================================

-- --- Garante a tabela base de repositórios (definição da v11) ---
CREATE TABLE IF NOT EXISTS project_repositories (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    github_repo         TEXT NOT NULL,
    label               TEXT,
    default_base_branch TEXT NOT NULL DEFAULT 'main',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_repos ON project_repositories(project_id);

ALTER TABLE project_repositories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read repos" ON project_repositories;
CREATE POLICY "auth read repos" ON project_repositories
    FOR SELECT TO authenticated USING (true);

ALTER TABLE features ADD COLUMN IF NOT EXISTS repository_id UUID REFERENCES project_repositories(id);

-- Backfill: cada projeto com github_repo vira um repositório default (idempotente)
DO $$
DECLARE
    proj RECORD;
    repo_id UUID;
BEGIN
    FOR proj IN SELECT id, github_repo FROM projects WHERE github_repo IS NOT NULL LOOP
        SELECT id INTO repo_id
        FROM project_repositories
        WHERE project_id = proj.id AND github_repo = proj.github_repo
        LIMIT 1;

        IF repo_id IS NULL THEN
            INSERT INTO project_repositories (project_id, github_repo, label)
            VALUES (proj.id, proj.github_repo, proj.github_repo)
            RETURNING id INTO repo_id;
        END IF;

        UPDATE features
        SET repository_id = repo_id
        WHERE project_id = proj.id
          AND repository_id IS NULL
          AND (github_repo = proj.github_repo OR github_repo IS NULL);
    END LOOP;
END $$;

-- Garante a tabela na publicação de realtime (sem erro se já estiver)
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE project_repositories;
EXCEPTION WHEN duplicate_object THEN
    NULL;
END $$;

-- ============================================================
-- Passo 1: revisão reforçada para áreas sensíveis (config por projeto)
-- ============================================================
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS require_reinforced_review BOOLEAN DEFAULT false;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS sensitive_paths TEXT;

-- ============================================================
-- Passo 2: dependências entre repositórios numa feature multi-repo
-- ============================================================
ALTER TABLE project_repositories ADD COLUMN IF NOT EXISTS depends_on TEXT;
ALTER TABLE project_repositories ADD COLUMN IF NOT EXISTS description TEXT;
