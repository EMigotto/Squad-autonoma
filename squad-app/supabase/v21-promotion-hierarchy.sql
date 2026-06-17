-- ============================================================
-- Migration v21: Hierarquia de promoção de ambientes
-- ============================================================
-- Cada ambiente aponta para o próximo ambiente da cadeia (promotes_to_id).
-- Ex.: Dev.promotes_to_id = Homologação ; Homologação.promotes_to_id = Produção.
-- Permite abrir 1 único PR de elevação: branch do env atual → branch do env destino.
-- Idempotente.
-- ============================================================

ALTER TABLE environments
  ADD COLUMN IF NOT EXISTS promotes_to_id UUID REFERENCES environments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_environments_promotes_to ON environments(promotes_to_id);
