-- ============================================================
-- Migration v4: cancelled status + chat history + early complete
-- ============================================================

-- Adiciona 'cancelled' nos status válidos de cards
ALTER TABLE cards DROP CONSTRAINT IF EXISTS cards_status_check;
ALTER TABLE cards ADD CONSTRAINT cards_status_check CHECK (
    status IN ('queued','running','awaiting_review','approved','rejected','done','cancelled')
);

-- Tabela pra histórico de chat com o agente (alem do que está na session do Claude)
-- Usada pra mostrar timeline persistente no card mesmo se a session fechar
CREATE TABLE IF NOT EXISTS card_chat_messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id         UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    session_id      TEXT,
    role            TEXT NOT NULL CHECK (role IN ('user','agent','system')),
    content         TEXT NOT NULL,
    sent_by         UUID REFERENCES auth.users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_card ON card_chat_messages(card_id, created_at);

ALTER TABLE card_chat_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated read chat" ON card_chat_messages;
CREATE POLICY "authenticated read chat" ON card_chat_messages
    FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "authenticated insert chat" ON card_chat_messages;
CREATE POLICY "authenticated insert chat" ON card_chat_messages
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = sent_by);

ALTER PUBLICATION supabase_realtime ADD TABLE card_chat_messages;

-- Adiciona coluna de marcação de cancelamento/complete em features
ALTER TABLE features ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE features ADD COLUMN IF NOT EXISTS cancelled_reason TEXT;
ALTER TABLE features ADD COLUMN IF NOT EXISTS completed_early_at TIMESTAMPTZ;
