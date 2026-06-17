-- ============================================================
-- Migration v11: múltiplos repositórios por projeto
-- ============================================================
-- Um projeto (nome + sigla do time) pode ter VÁRIOS repositórios.
-- Cada feature/board é associado a um repositório do projeto.
-- ============================================================

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

-- features apontam pra um repositório específico do projeto
ALTER TABLE features ADD COLUMN IF NOT EXISTS repository_id UUID REFERENCES project_repositories(id);

-- ============================================================
-- BACKFILL: cada projeto com github_repo vira um repositório default
-- ============================================================
DO $$
DECLARE
    proj RECORD;
    repo_id UUID;
BEGIN
    FOR proj IN SELECT id, github_repo FROM projects WHERE github_repo IS NOT NULL LOOP
        -- Cria o repositório se ainda não existe pra esse projeto
        SELECT id INTO repo_id
        FROM project_repositories
        WHERE project_id = proj.id AND github_repo = proj.github_repo
        LIMIT 1;

        IF repo_id IS NULL THEN
            INSERT INTO project_repositories (project_id, github_repo, label)
            VALUES (proj.id, proj.github_repo, proj.github_repo)
            RETURNING id INTO repo_id;
        END IF;

        -- Associa as features existentes do projeto a esse repositório
        UPDATE features
        SET repository_id = repo_id
        WHERE project_id = proj.id
          AND repository_id IS NULL
          AND (github_repo = proj.github_repo OR github_repo IS NULL);
    END LOOP;
END $$;

ALTER PUBLICATION supabase_realtime ADD TABLE project_repositories;
