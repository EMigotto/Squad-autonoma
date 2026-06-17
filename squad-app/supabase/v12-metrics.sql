-- ============================================================
-- Migration v12: Indicadores (métricas) por card + config de custos
-- ============================================================
-- Mede os 4 indicadores do material de treinamento:
--   1. Cycle time (tempo da ideia à entrega)
--   2. Taxa de aprovação na 1ª (gates sem rejeição)
--   3. Cobertura de testes (% de critérios)
--   4. Custo por feature (tokens + tempo humano)
-- ============================================================

-- Config de custos de referência (por projeto / equipe) em app_settings
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS human_hourly_cost      NUMERIC DEFAULT 0;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS token_cost_input_mtok  NUMERIC DEFAULT 0;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS token_cost_output_mtok NUMERIC DEFAULT 0;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS metrics_currency       TEXT DEFAULT 'BRL';

CREATE TABLE IF NOT EXISTS card_metrics (
    card_id            UUID PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
    feature_id         UUID REFERENCES features(id) ON DELETE CASCADE,
    project_id         UUID REFERENCES projects(id),
    team_id            UUID REFERENCES teams(id),

    -- 1. cycle time
    cycle_time_hours   NUMERIC,
    started_at         TIMESTAMPTZ,
    completed_at       TIMESTAMPTZ,
    is_done            BOOLEAN DEFAULT false,

    -- 2. taxa de aprovação
    gates_total        INT DEFAULT 0,
    gates_rejected     INT DEFAULT 0,
    first_pass         BOOLEAN,

    -- 3. cobertura de testes (preenchível pelo QA ou manual)
    test_coverage_pct  NUMERIC,

    -- 4. custo
    input_tokens       BIGINT DEFAULT 0,
    output_tokens      BIGINT DEFAULT 0,
    token_cost         NUMERIC DEFAULT 0,
    human_hours        NUMERIC,
    human_cost         NUMERIC DEFAULT 0,
    total_cost         NUMERIC DEFAULT 0,

    iso_week           TEXT,           -- YYYY-Www para agregação semanal
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_card_metrics_project ON card_metrics(project_id);
CREATE INDEX IF NOT EXISTS idx_card_metrics_team ON card_metrics(team_id);
CREATE INDEX IF NOT EXISTS idx_card_metrics_week ON card_metrics(iso_week);

ALTER TABLE card_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read metrics" ON card_metrics;
CREATE POLICY "auth read metrics" ON card_metrics
    FOR SELECT TO authenticated USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE card_metrics;
