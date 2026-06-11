-- ============================================================
-- Migration v29: ROI por alocação de TIME (custo fully-loaded)
-- ============================================================
-- baseline_team_size: nº de pessoas alocadas no modelo manual (PM, TL, devs, QA)
-- baseline_cost_mode: 'team' (lifecycle x time x custo) ou 'effort' (1 dev)
-- ============================================================
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS baseline_team_size NUMERIC DEFAULT 4;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS baseline_cost_mode TEXT DEFAULT 'team';
