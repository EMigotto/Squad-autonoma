-- ============================================================
-- Migration v24: Branch específica por feature (opcional)
-- ============================================================
-- Cada feature pode opcionalmente declarar:
--   working_branch: branch onde os agentes vão escrever tudo
--   source_branch:  branch raiz da qual clonar (caso a working_branch
--                   não exista; senão usa a default_base_branch da app)
-- Se ambas vazias, mantém o comportamento atual (usa a branch do ambiente).
-- Idempotente.
-- ============================================================

ALTER TABLE features ADD COLUMN IF NOT EXISTS working_branch TEXT;
ALTER TABLE features ADD COLUMN IF NOT EXISTS source_branch  TEXT;
