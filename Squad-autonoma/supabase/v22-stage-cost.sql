-- ============================================================
-- Migration v22: Custo por etapa (incremental por execução)
-- ============================================================
-- Cada execução (card_stage_runs) ganha colunas de uso/custo. Permite ver
-- quanto cada etapa gastou e acumular o custo total da feature passo a passo.
-- Idempotente.
-- ============================================================

ALTER TABLE card_stage_runs ADD COLUMN IF NOT EXISTS input_tokens  BIGINT  DEFAULT 0;
ALTER TABLE card_stage_runs ADD COLUMN IF NOT EXISTS output_tokens BIGINT  DEFAULT 0;
ALTER TABLE card_stage_runs ADD COLUMN IF NOT EXISTS token_cost    NUMERIC DEFAULT 0;
ALTER TABLE card_stage_runs ADD COLUMN IF NOT EXISTS human_hours   NUMERIC;
ALTER TABLE card_stage_runs ADD COLUMN IF NOT EXISTS human_cost    NUMERIC DEFAULT 0;
ALTER TABLE card_stage_runs ADD COLUMN IF NOT EXISTS total_cost    NUMERIC DEFAULT 0;
