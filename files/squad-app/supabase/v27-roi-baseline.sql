-- ============================================================
-- Migration v27: ROI / baseline humano (justificativa de investimento)
-- ============================================================
-- Parâmetros (configuráveis por time) para estimar quanto a MESMA feature
-- custaria/demoraria num desenvolvimento humano tradicional (sem agentes),
-- usando linhas de código como referência de mercado.
--   baseline_loc_per_dev_day: LOC prontas+testadas por dev/dia (ref. conservadora)
--   baseline_hours_per_day:   horas efetivas de dev por dia
--   baseline_dev_hourly:      custo/hora do dev humano (0 = usa human_hourly_cost)
-- loc_estimate: linhas adicionadas pela feature (medido no GitHub na conclusão).
-- Idempotente.
-- ============================================================
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS baseline_loc_per_dev_day NUMERIC DEFAULT 50;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS baseline_hours_per_day NUMERIC DEFAULT 6;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS baseline_dev_hourly NUMERIC DEFAULT 0;
ALTER TABLE card_metrics ADD COLUMN IF NOT EXISTS loc_estimate INTEGER;
