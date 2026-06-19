-- v40: regressão de etapa em "modo ajuste". Quando um card volta para uma etapa
-- anterior (ex.: QA → Desenvolvimento) para um ajuste pontual, o agente NÃO
-- refaz a construção: ele sabe que o previsto da fase já foi entregue e aguarda
-- a instrução específica pelo chat, implementando apenas aquilo.
ALTER TABLE cards ADD COLUMN IF NOT EXISTS adjustment_mode BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS adjustment_note TEXT;       -- motivo/itens do ajuste
ALTER TABLE cards ADD COLUMN IF NOT EXISTS regressed_from TEXT;        -- etapa de onde regrediu
