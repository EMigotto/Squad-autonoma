-- ============================================================
-- Migration v5: agents customizáveis + histórico de execução por stage
-- ============================================================

-- Definições dos agents, gerenciáveis via UI de Settings
CREATE TABLE IF NOT EXISTS agent_definitions (
    role            TEXT PRIMARY KEY,                            -- pm, tech_lead, security_reviewer, ...
    name            TEXT NOT NULL,                               -- "PM Agent", "Security Reviewer"
    stage           TEXT NOT NULL,                               -- discovery, planning, development, qa
    model           TEXT NOT NULL DEFAULT 'claude-opus-4-6',
    system_prompt   TEXT NOT NULL,
    sort_order      INT  NOT NULL DEFAULT 100,                   -- ordem dentro da mesma stage
    enabled         BOOLEAN NOT NULL DEFAULT true,
    is_builtin      BOOLEAN NOT NULL DEFAULT false,              -- se true, não pode ser deletado
    description     TEXT,                                        -- descrição curta pro Settings
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_defs_stage ON agent_definitions(stage, sort_order);

ALTER TABLE agent_definitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read agents" ON agent_definitions;
CREATE POLICY "auth read agents" ON agent_definitions
    FOR SELECT TO authenticated USING (true);

-- Histórico de execução de cada stage de cada card
-- Permite ver quantas vezes um stage rodou (reruns por rejeição), tokens gastos, etc
CREATE TABLE IF NOT EXISTS card_stage_runs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id             UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    stage               TEXT NOT NULL,
    agent_role          TEXT,
    claude_session_id   TEXT,
    started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at            TIMESTAMPTZ,
    status              TEXT NOT NULL DEFAULT 'running',          -- running, completed, failed
    summary             TEXT
);
CREATE INDEX IF NOT EXISTS idx_stage_runs_card ON card_stage_runs(card_id, started_at DESC);

ALTER TABLE card_stage_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read runs" ON card_stage_runs;
CREATE POLICY "auth read runs" ON card_stage_runs
    FOR SELECT TO authenticated USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE agent_definitions;
ALTER PUBLICATION supabase_realtime ADD TABLE card_stage_runs;

-- ============================================================
-- IMPORTANTE: o seed dos 7 agents builtin acontece no endpoint
-- /admin/setup-agents na primeira chamada (lê de lib/agents.ts).
-- Não embedo os prompts gigantes aqui.
-- ============================================================
