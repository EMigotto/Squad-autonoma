-- ============================================================
-- Migration v13: Pessoas por projeto (base de custo dos indicadores)
-- ============================================================
-- Em vez de digitar o custo/hora à mão, cadastram-se as pessoas do projeto
-- (nome, cargo, salário mensal, horas/mês). O custo/hora do projeto passa a
-- ser derivado automaticamente da média das pessoas e gravado em
-- app_settings.human_hourly_cost (que o cálculo de métricas já consome).
-- ============================================================

CREATE TABLE IF NOT EXISTS project_people (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    role            TEXT,
    monthly_salary  NUMERIC NOT NULL DEFAULT 0,
    monthly_hours   NUMERIC NOT NULL DEFAULT 160,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by      UUID REFERENCES auth.users(id)
);
CREATE INDEX IF NOT EXISTS idx_project_people_project ON project_people(project_id);

ALTER TABLE project_people ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read people" ON project_people;
CREATE POLICY "auth read people" ON project_people
    FOR SELECT TO authenticated USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE project_people;
