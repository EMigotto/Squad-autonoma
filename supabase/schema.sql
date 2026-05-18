-- ============================================================
-- Squad Autônomo — Schema para Supabase
-- Cole no SQL Editor do Supabase e execute.
-- ============================================================

-- pgcrypto já está habilitado no Supabase, mas garantimos:
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- user_profiles: extensão de auth.users com role do squad
-- ============================================================
CREATE TABLE user_profiles (
    id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    role        TEXT NOT NULL CHECK (role IN ('pm','tech_lead','qa','admin')),
    slack_id    TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trigger: cria user_profile automaticamente quando alguém faz signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.user_profiles (id, name, role)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
        COALESCE(NEW.raw_user_meta_data->>'role', 'pm')
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- Catálogo de stages
-- ============================================================
CREATE TABLE stages (
    code           TEXT PRIMARY KEY,
    label          TEXT NOT NULL,
    sort_order     INT  NOT NULL,
    requires_role  TEXT NOT NULL
);
INSERT INTO stages (code, label, sort_order, requires_role) VALUES
    ('discovery',   'Discovery',             10, 'pm'),
    ('planning',    'Planejamento técnico',  20, 'tech_lead'),
    ('development', 'Desenvolvimento',       30, 'tech_lead'),
    ('qa',          'Qualidade',             40, 'qa'),
    ('done',        'Concluído',             50, 'admin');

-- ============================================================
-- Registry de agents do Claude (versionado)
-- ============================================================
CREATE TABLE agents (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role                  TEXT NOT NULL,
    claude_agent_id       TEXT NOT NULL,
    claude_agent_version  INT  NOT NULL,
    system_prompt_hash    TEXT NOT NULL,
    is_current            BOOLEAN NOT NULL DEFAULT true,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (role, claude_agent_id, claude_agent_version)
);
CREATE INDEX idx_agents_current ON agents(role) WHERE is_current = true;

-- ============================================================
-- Features
-- ============================================================
CREATE TABLE features (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug                     TEXT UNIQUE NOT NULL,
    title                    TEXT NOT NULL,
    description              TEXT,
    current_stage            TEXT NOT NULL REFERENCES stages(code) DEFAULT 'discovery',
    claude_memory_store_id   TEXT,
    claude_environment_id    TEXT,
    github_repo              TEXT NOT NULL,
    github_parent_issue      INT,
    github_vault_credential  TEXT,
    created_by               UUID REFERENCES auth.users(id),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_features_stage ON features(current_stage);

-- ============================================================
-- Cards (manifestação visual da feature em um stage)
-- ============================================================
CREATE TABLE cards (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    feature_id         UUID NOT NULL REFERENCES features(id) ON DELETE CASCADE,
    stage              TEXT NOT NULL REFERENCES stages(code),
    claude_session_id  TEXT,
    claude_agent_id    UUID REFERENCES agents(id),
    status             TEXT NOT NULL CHECK (status IN (
        'queued','running','awaiting_review','approved','rejected','done'
    )) DEFAULT 'queued',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (feature_id, stage)
);
CREATE INDEX idx_cards_status ON cards(status);
CREATE INDEX idx_cards_feature ON cards(feature_id);
CREATE INDEX idx_cards_session ON cards(claude_session_id);

-- ============================================================
-- Gates humanos
-- ============================================================
CREATE TABLE human_gates (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id           UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    assignee_id       UUID REFERENCES auth.users(id),
    summary           TEXT,
    artifacts_json    JSONB,
    decision          TEXT CHECK (decision IN ('approved','rejected')),
    decision_reason   TEXT,
    decided_by        UUID REFERENCES auth.users(id),
    decided_at        TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_human_gates_open ON human_gates(assignee_id) WHERE decision IS NULL;

-- ============================================================
-- Chunks técnicos
-- ============================================================
CREATE TABLE chunks (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    feature_id            UUID NOT NULL REFERENCES features(id) ON DELETE CASCADE,
    title                 TEXT NOT NULL,
    description           TEXT,
    skill                 TEXT NOT NULL,
    github_issue_number   INT,
    depends_on            UUID[] NOT NULL DEFAULT '{}',
    status                TEXT NOT NULL CHECK (status IN (
        'planned','claimed','in_progress','in_review','approved','rejected','done'
    )) DEFAULT 'planned',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_chunks_feature ON chunks(feature_id);
CREATE INDEX idx_chunks_skill_status ON chunks(skill, status);

-- ============================================================
-- Chunk runs
-- ============================================================
CREATE TABLE chunk_runs (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chunk_id           UUID NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
    claude_session_id  TEXT NOT NULL,
    claude_agent_id    UUID REFERENCES agents(id),
    github_branch      TEXT,
    github_pr_number   INT,
    started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at        TIMESTAMPTZ
);
CREATE INDEX idx_chunk_runs_session ON chunk_runs(claude_session_id);

-- ============================================================
-- Artifacts produzidos
-- ============================================================
CREATE TABLE artifacts (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    feature_id            UUID NOT NULL REFERENCES features(id) ON DELETE CASCADE,
    chunk_id              UUID REFERENCES chunks(id),
    kind                  TEXT NOT NULL,
    path_in_repo          TEXT,
    github_pr_number      INT,
    produced_by_session   TEXT NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_artifacts_feature ON artifacts(feature_id);

-- ============================================================
-- Webhook events (audit + dedup)
-- ============================================================
CREATE TABLE webhook_events (
    id              TEXT PRIMARY KEY,
    event_type      TEXT NOT NULL,
    payload         JSONB NOT NULL,
    received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at    TIMESTAMPTZ,
    error           TEXT
);
CREATE INDEX idx_webhook_events_unprocessed ON webhook_events(received_at) WHERE processed_at IS NULL;

-- ============================================================
-- Triggers updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_features_touch BEFORE UPDATE ON features
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_cards_touch BEFORE UPDATE ON cards
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_chunks_touch BEFORE UPDATE ON chunks
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============================================================
-- Row Level Security
-- MVP: usuários autenticados podem ler tudo. Escritas vão pela
-- service role (do servidor), não pelo cliente browser.
-- Em produção, refine policies por role (PM só decide gates de PM, etc).
-- ============================================================
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE features      ENABLE ROW LEVEL SECURITY;
ALTER TABLE cards         ENABLE ROW LEVEL SECURITY;
ALTER TABLE human_gates   ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunks        ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunk_runs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifacts     ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read user_profiles" ON user_profiles
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated read features" ON features
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated read cards" ON cards
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated read human_gates" ON human_gates
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated read chunks" ON chunks
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated read chunk_runs" ON chunk_runs
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated read artifacts" ON artifacts
    FOR SELECT TO authenticated USING (true);

-- agents, stages, webhook_events: só service role acessa, sem policy

-- ============================================================
-- Habilita Realtime nas tabelas que a UI escuta
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE cards;
ALTER PUBLICATION supabase_realtime ADD TABLE human_gates;
ALTER PUBLICATION supabase_realtime ADD TABLE features;
