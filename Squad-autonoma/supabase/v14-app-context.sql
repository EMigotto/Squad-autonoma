-- ============================================================
-- Migration v14: Contexto de aplicação por projeto
-- ============================================================
-- Suporte a aplicações NOVAS (greenfield) e EXISTENTES (legado):
--   - app_type, tech_stack e instructions_path no projeto
--   - base de conhecimento (project_knowledge)
--   - aprendizados acumulados para evolução contínua (project_learnings / "Dreaming")
-- ============================================================

ALTER TABLE projects ADD COLUMN IF NOT EXISTS app_type TEXT NOT NULL DEFAULT 'new'; -- new | existing
ALTER TABLE projects ADD COLUMN IF NOT EXISTS app_kind TEXT;          -- app | microservice | monolith | library | other
ALTER TABLE projects ADD COLUMN IF NOT EXISTS tech_stack TEXT;        -- ex: "Next.js, Node, Postgres"
ALTER TABLE projects ADD COLUMN IF NOT EXISTS instructions_path TEXT DEFAULT 'CLAUDE.md';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMPTZ;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS claude_environment_id TEXT;

-- Base de conhecimento: docs, runbooks, ADRs existentes, convenções, links
CREATE TABLE IF NOT EXISTS project_knowledge (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    kind        TEXT NOT NULL DEFAULT 'doc',  -- doc | runbook | adr | convention | api | link
    location    TEXT,                          -- caminho no repo OU url
    notes       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by  UUID REFERENCES auth.users(id)
);
CREATE INDEX IF NOT EXISTS idx_knowledge_project ON project_knowledge(project_id);

-- Aprendizados acumulados (Dreaming): consolidados periodicamente nas instructions
CREATE TABLE IF NOT EXISTS project_learnings (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    card_id     UUID REFERENCES cards(id) ON DELETE SET NULL,
    kind        TEXT NOT NULL DEFAULT 'insight', -- insight | decision | pitfall | convention
    content     TEXT NOT NULL,
    applied_at  TIMESTAMPTZ,                      -- quando foi consolidado nas instructions
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_learnings_project ON project_learnings(project_id);

ALTER TABLE project_knowledge ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read knowledge" ON project_knowledge;
CREATE POLICY "auth read knowledge" ON project_knowledge FOR SELECT TO authenticated USING (true);

ALTER TABLE project_learnings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read learnings" ON project_learnings;
CREATE POLICY "auth read learnings" ON project_learnings FOR SELECT TO authenticated USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE project_knowledge;
ALTER PUBLICATION supabase_realtime ADD TABLE project_learnings;
