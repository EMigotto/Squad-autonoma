-- ============================================================
-- SETUP COMPLETO — idempotente, seguro de rodar de qualquer estado
-- ============================================================
-- Este arquivo aplica TUDO que as migrations v3, v4, v5 e v6 fariam,
-- de forma segura mesmo que algumas partes já tenham sido aplicadas.
-- Pode rodar quantas vezes quiser. Cole inteiro no SQL Editor do Supabase.
-- ============================================================

-- Helper: adiciona tabela ao realtime só se ainda não estiver
CREATE OR REPLACE FUNCTION _add_to_realtime(tbl text) RETURNS void AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = tbl
    ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tbl);
    END IF;
END $$ LANGUAGE plpgsql;

-- ============================================================
-- V3: stages RLS + app_settings
-- ============================================================
ALTER TABLE stages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anyone read stages" ON stages;
CREATE POLICY "anyone read stages" ON stages
    FOR SELECT TO authenticated, anon USING (true);

CREATE TABLE IF NOT EXISTS app_settings (
    id                          INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    auto_merge_prs              BOOLEAN NOT NULL DEFAULT false,
    commit_to_existing_branch   BOOLEAN NOT NULL DEFAULT false,
    auto_advance_after_pm       BOOLEAN NOT NULL DEFAULT false,
    auto_advance_after_tl       BOOLEAN NOT NULL DEFAULT false,
    default_base_branch         TEXT NOT NULL DEFAULT 'main',
    notification_slack_webhook  TEXT,
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by                  UUID REFERENCES auth.users(id)
);
INSERT INTO app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated read settings" ON app_settings;
CREATE POLICY "authenticated read settings" ON app_settings
    FOR SELECT TO authenticated USING (true);

SELECT _add_to_realtime('app_settings');
-- ============================================================
-- V4: cancelled status + chat history + early complete
-- ============================================================
ALTER TABLE cards DROP CONSTRAINT IF EXISTS cards_status_check;
ALTER TABLE cards ADD CONSTRAINT cards_status_check CHECK (
    status IN ('queued','running','awaiting_review','approved','rejected','done','cancelled')
);

CREATE TABLE IF NOT EXISTS card_chat_messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id         UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    session_id      TEXT,
    role            TEXT NOT NULL CHECK (role IN ('user','agent','system')),
    content         TEXT NOT NULL,
    sent_by         UUID REFERENCES auth.users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_card ON card_chat_messages(card_id, created_at);

ALTER TABLE card_chat_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated read chat" ON card_chat_messages;
CREATE POLICY "authenticated read chat" ON card_chat_messages
    FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "authenticated insert chat" ON card_chat_messages;
CREATE POLICY "authenticated insert chat" ON card_chat_messages
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = sent_by);

SELECT _add_to_realtime('card_chat_messages');

ALTER TABLE features ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE features ADD COLUMN IF NOT EXISTS cancelled_reason TEXT;
ALTER TABLE features ADD COLUMN IF NOT EXISTS completed_early_at TIMESTAMPTZ;

-- ============================================================
-- V5: agent_definitions + card_stage_runs
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_definitions (
    role            TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    stage           TEXT NOT NULL,
    model           TEXT NOT NULL DEFAULT 'claude-opus-4-6',
    system_prompt   TEXT NOT NULL,
    sort_order      INT  NOT NULL DEFAULT 100,
    enabled         BOOLEAN NOT NULL DEFAULT true,
    is_builtin      BOOLEAN NOT NULL DEFAULT false,
    description     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_defs_stage ON agent_definitions(stage, sort_order);

ALTER TABLE agent_definitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read agents" ON agent_definitions;
CREATE POLICY "auth read agents" ON agent_definitions
    FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS card_stage_runs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id             UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    stage               TEXT NOT NULL,
    agent_role          TEXT,
    claude_session_id   TEXT,
    started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at            TIMESTAMPTZ,
    status              TEXT NOT NULL DEFAULT 'running',
    summary             TEXT
);
CREATE INDEX IF NOT EXISTS idx_stage_runs_card ON card_stage_runs(card_id, started_at DESC);

ALTER TABLE card_stage_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read runs" ON card_stage_runs;
CREATE POLICY "auth read runs" ON card_stage_runs
    FOR SELECT TO authenticated USING (true);

SELECT _add_to_realtime('agent_definitions');
SELECT _add_to_realtime('card_stage_runs');

-- ============================================================
-- V6: consolida cards órfãos duplicados (defensivo)
-- ============================================================
DO $$
DECLARE
    feat RECORD;
    survivor_id UUID;
    stage_rank JSONB := '{"discovery":0,"planning":1,"development":2,"qa":3,"done":4}';
    has_chat BOOLEAN := to_regclass('public.card_chat_messages') IS NOT NULL;
    has_runs BOOLEAN := to_regclass('public.card_stage_runs') IS NOT NULL;
BEGIN
    FOR feat IN SELECT DISTINCT feature_id FROM cards LOOP
        -- sobrevivente: maior stage não cancelado
        SELECT id INTO survivor_id
        FROM cards
        WHERE feature_id = feat.feature_id AND status <> 'cancelled'
        ORDER BY (stage_rank ->> stage)::int DESC, updated_at DESC
        LIMIT 1;

        IF survivor_id IS NULL THEN
            SELECT id INTO survivor_id
            FROM cards
            WHERE feature_id = feat.feature_id
            ORDER BY (stage_rank ->> stage)::int DESC, updated_at DESC
            LIMIT 1;
        END IF;

        -- só reassocia se houver órfãos
        IF has_runs THEN
            UPDATE card_stage_runs SET card_id = survivor_id
            WHERE card_id IN (
                SELECT id FROM cards
                WHERE feature_id = feat.feature_id AND id <> survivor_id
            );
        END IF;

        UPDATE human_gates SET card_id = survivor_id
        WHERE card_id IN (
            SELECT id FROM cards
            WHERE feature_id = feat.feature_id AND id <> survivor_id
        );

        IF has_chat THEN
            UPDATE card_chat_messages SET card_id = survivor_id
            WHERE card_id IN (
                SELECT id FROM cards
                WHERE feature_id = feat.feature_id AND id <> survivor_id
            );
        END IF;

        DELETE FROM cards
        WHERE feature_id = feat.feature_id AND id <> survivor_id;
    END LOOP;
END $$;

-- Limpa o helper
DROP FUNCTION IF EXISTS _add_to_realtime(regclass);

-- ============================================================
-- Verificação final (deve retornar 0 linhas)
-- ============================================================
-- SELECT feature_id, count(*) FROM cards GROUP BY feature_id HAVING count(*) > 1;
