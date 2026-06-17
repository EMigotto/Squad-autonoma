-- ============================================================
-- Migration v6: consolida cards órfãos duplicados
-- ============================================================
-- A versão antiga do orquestrador criava um NOVO card a cada transição de
-- stage (em vez de mover o mesmo card). Isso deixou features com múltiplos
-- cards — ex: a C2 tem um card em 'discovery' e outro em 'planning'.
--
-- Esta migration mantém apenas o card mais avançado (maior stage) de cada
-- feature e remove os órfãos das stages anteriores. As stage_runs e gates
-- dos órfãos são reassociados ao card sobrevivente para não perder histórico.
-- ============================================================

DO $$
DECLARE
    feat RECORD;
    survivor_id UUID;
    stage_rank JSONB := '{"discovery":0,"planning":1,"development":2,"qa":3,"done":4}';
    has_chat BOOLEAN := to_regclass('public.card_chat_messages') IS NOT NULL;
    has_runs BOOLEAN := to_regclass('public.card_stage_runs') IS NOT NULL;
BEGIN
    FOR feat IN SELECT DISTINCT feature_id FROM cards LOOP
        -- Encontra o card sobrevivente: maior stage rank, não cancelado
        SELECT id INTO survivor_id
        FROM cards
        WHERE feature_id = feat.feature_id
          AND status <> 'cancelled'
        ORDER BY (stage_rank ->> stage)::int DESC, updated_at DESC
        LIMIT 1;

        -- Se todos cancelados, pega qualquer um (o mais avançado)
        IF survivor_id IS NULL THEN
            SELECT id INTO survivor_id
            FROM cards
            WHERE feature_id = feat.feature_id
            ORDER BY (stage_rank ->> stage)::int DESC, updated_at DESC
            LIMIT 1;
        END IF;

        -- Reassocia stage_runs dos órfãos ao sobrevivente (se a tabela existe)
        IF has_runs THEN
            UPDATE card_stage_runs
            SET card_id = survivor_id
            WHERE card_id IN (
                SELECT id FROM cards
                WHERE feature_id = feat.feature_id AND id <> survivor_id
            );
        END IF;

        -- Reassocia gates dos órfãos ao sobrevivente
        UPDATE human_gates
        SET card_id = survivor_id
        WHERE card_id IN (
            SELECT id FROM cards
            WHERE feature_id = feat.feature_id AND id <> survivor_id
        );

        -- Reassocia chat messages (se a tabela existe)
        IF has_chat THEN
            UPDATE card_chat_messages
            SET card_id = survivor_id
            WHERE card_id IN (
                SELECT id FROM cards
                WHERE feature_id = feat.feature_id AND id <> survivor_id
            );
        END IF;

        -- Remove os cards órfãos
        DELETE FROM cards
        WHERE feature_id = feat.feature_id AND id <> survivor_id;
    END LOOP;
END $$;

-- Verificação: deve retornar 0 features com mais de 1 card
-- SELECT feature_id, count(*) FROM cards GROUP BY feature_id HAVING count(*) > 1;
