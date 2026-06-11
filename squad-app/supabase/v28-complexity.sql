-- ============================================================
-- Migration v28: modo COMPLEXIDADE (S/M/L/XL) p/ baseline de ROI
-- ============================================================
-- Alternativa ao LOC quando a feature não tem linhas medíveis (config/infra,
-- branch removida, etc.). Horas de dev humano por tamanho, configuráveis.
-- Defaults = referência de mercado: S~1d, M~3d, L~2sem, XL~5sem (6h/dia).
-- baseline_default_complexity: tamanho assumido quando não há LOC nem tag.
-- card_metrics.complexity: tamanho atribuído à feature (S/M/L/XL) ou null.
-- Idempotente.
-- ============================================================
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS baseline_hours_s NUMERIC DEFAULT 8;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS baseline_hours_m NUMERIC DEFAULT 24;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS baseline_hours_l NUMERIC DEFAULT 80;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS baseline_hours_xl NUMERIC DEFAULT 200;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS baseline_default_complexity TEXT DEFAULT 'M';
ALTER TABLE card_metrics ADD COLUMN IF NOT EXISTS complexity TEXT;
