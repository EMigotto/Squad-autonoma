-- ============================================================
-- Migration v29: ROI por ALOCAÇÃO DE TIME (visão realista de custo manual)
-- ============================================================
-- O custo manual passa a refletir um TIME alocado pelos dias de calendário do
-- projeto tradicional (não o esforço de 1 dev). Custo = pessoas-dia × diária.
--   baseline_calendar_days_{s,m,l,xl}: duração de calendário do projeto humano
--     por tamanho (defaults de mercado: S~10, M~38, L~90, XL~180 dias).
--   baseline_team_size: nº de pessoas alocadas no time tradicional (default 4).
-- Idempotente.
-- ============================================================
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS baseline_calendar_days_s NUMERIC DEFAULT 10;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS baseline_calendar_days_m NUMERIC DEFAULT 38;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS baseline_calendar_days_l NUMERIC DEFAULT 90;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS baseline_calendar_days_xl NUMERIC DEFAULT 180;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS baseline_team_size NUMERIC DEFAULT 4;
