-- ============================================================
-- Migration v9: Times e Projetos (multi-tenancy)
-- ============================================================
-- Introduz a hierarquia Time → Projetos. Cada projeto carrega suas próprias
-- configurações: agentes, repositório, settings e features.
--
-- BACKFILL SEGURO: cria um "Time Padrão" + "Projeto Padrão" e associa TODOS
-- os registros existentes a ele, para não quebrar o que já funciona.
-- ============================================================

CREATE TABLE IF NOT EXISTS teams (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    created_by  UUID REFERENCES auth.users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS team_members (
    team_id     UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role        TEXT NOT NULL DEFAULT 'member', -- owner, member
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, user_id)
);

CREATE TABLE IF NOT EXISTS projects (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id             UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,
    sigla               TEXT NOT NULL,
    github_repo         TEXT,
    default_base_branch TEXT NOT NULL DEFAULT 'main',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          UUID REFERENCES auth.users(id)
);
CREATE INDEX IF NOT EXISTS idx_projects_team ON projects(team_id);

-- active_project_id no perfil do usuário (qual projeto ele está vendo)
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS active_project_id UUID;

-- project_id nas tabelas que carregam config por projeto
ALTER TABLE features ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id);
ALTER TABLE agent_definitions ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id);
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id);

-- RLS de leitura
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read teams" ON teams;
CREATE POLICY "auth read teams" ON teams FOR SELECT TO authenticated USING (true);

ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read members" ON team_members;
CREATE POLICY "auth read members" ON team_members FOR SELECT TO authenticated USING (true);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read projects" ON projects;
CREATE POLICY "auth read projects" ON projects FOR SELECT TO authenticated USING (true);

-- ============================================================
-- BACKFILL
-- ============================================================
DO $$
DECLARE
    default_team_id UUID;
    default_project_id UUID;
    first_repo TEXT;
    first_user UUID;
BEGIN
    -- Só roda o backfill se ainda não há projetos
    IF EXISTS (SELECT 1 FROM projects LIMIT 1) THEN
        RAISE NOTICE 'projetos já existem — pulando backfill';
        RETURN;
    END IF;

    -- Pega um usuário pra ser owner (o primeiro do user_profiles)
    SELECT id INTO first_user FROM user_profiles LIMIT 1;

    -- Repo mais comum nas features existentes (pra herdar no projeto default)
    SELECT github_repo INTO first_repo
    FROM features
    WHERE github_repo IS NOT NULL
    GROUP BY github_repo
    ORDER BY count(*) DESC
    LIMIT 1;

    -- Cria time e projeto default
    INSERT INTO teams (name, created_by)
    VALUES ('Time Padrão', first_user)
    RETURNING id INTO default_team_id;

    INSERT INTO projects (team_id, name, sigla, github_repo, created_by)
    VALUES (
        default_team_id,
        'Projeto Padrão',
        'PAD',
        COALESCE(first_repo, 'EMigotto/certificado-digital'),
        first_user
    )
    RETURNING id INTO default_project_id;

    -- Adiciona todos os usuários como membros do time
    INSERT INTO team_members (team_id, user_id, role)
    SELECT default_team_id, id, 'owner' FROM user_profiles
    ON CONFLICT DO NOTHING;

    -- Associa registros existentes ao projeto default
    UPDATE features SET project_id = default_project_id WHERE project_id IS NULL;
    UPDATE agent_definitions SET project_id = default_project_id WHERE project_id IS NULL;
    UPDATE agents SET project_id = default_project_id WHERE project_id IS NULL;
    UPDATE app_settings SET project_id = default_project_id WHERE project_id IS NULL;
    UPDATE user_profiles SET active_project_id = default_project_id WHERE active_project_id IS NULL;

    RAISE NOTICE 'backfill completo: team=% project=%', default_team_id, default_project_id;
END $$;

-- ============================================================
-- Ajuste de unicidade dos agentes por projeto
-- (mesmo role pode existir em projetos diferentes)
-- ============================================================
-- Proteção: garante que não há project_id nulo antes de criar a PK composta
-- (caso o backfill tenha sido pulado por re-run parcial)
DO $$
DECLARE
    any_project UUID;
BEGIN
    SELECT id INTO any_project FROM projects ORDER BY created_at LIMIT 1;
    IF any_project IS NOT NULL THEN
        UPDATE agent_definitions SET project_id = any_project WHERE project_id IS NULL;
        UPDATE agents SET project_id = any_project WHERE project_id IS NULL;
        UPDATE features SET project_id = any_project WHERE project_id IS NULL;
        UPDATE app_settings SET project_id = any_project WHERE project_id IS NULL;
    END IF;
END $$;

-- agent_definitions: PK passa a ser (project_id, role)
ALTER TABLE agent_definitions DROP CONSTRAINT IF EXISTS agent_definitions_pkey;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'agent_definitions_project_role_pk'
    ) THEN
        ALTER TABLE agent_definitions
            ADD CONSTRAINT agent_definitions_project_role_pk PRIMARY KEY (project_id, role);
    END IF;
END $$;

-- features.slug deixa de ser globalmente único; passa a ser único por projeto
ALTER TABLE features DROP CONSTRAINT IF EXISTS features_slug_key;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'features_project_slug_key'
    ) THEN
        ALTER TABLE features
            ADD CONSTRAINT features_project_slug_key UNIQUE (project_id, slug);
    END IF;
END $$;

ALTER PUBLICATION supabase_realtime ADD TABLE projects;
