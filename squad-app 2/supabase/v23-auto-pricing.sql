-- ============================================================
-- Migration v23: Custo automático (preço por modelo + câmbio USD→BRL)
-- ============================================================
-- Cada execução guarda QUAL modelo rodou (ex.: claude-opus-4-6). O custo
-- vem automático de uma tabela de preços oficial da Anthropic (em USD),
-- convertido em BRL pelo câmbio configurável no time. Sem mais preencher
-- R$/Mtok manualmente.
-- Idempotente.
-- ============================================================

ALTER TABLE card_stage_runs ADD COLUMN IF NOT EXISTS model TEXT;

-- Câmbio USD → BRL (default 5.0 — ajustável em Settings)
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS usd_to_brl NUMERIC DEFAULT 5.0;
UPDATE app_settings SET usd_to_brl = 5.0 WHERE usd_to_brl IS NULL;
