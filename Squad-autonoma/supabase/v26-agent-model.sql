-- ============================================================
-- Migration v26: modelo por agente implantado (seleção no disparo)
-- ============================================================
-- Permite ter, por (time, papel), variantes do agente em modelos diferentes.
-- Quando o humano escolhe o modelo no diálogo de transição, o sistema usa
-- (ou implanta sob demanda) o agente daquele modelo.
-- Idempotente.
-- ============================================================
ALTER TABLE agents ADD COLUMN IF NOT EXISTS model TEXT;
