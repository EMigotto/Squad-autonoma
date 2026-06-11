-- ============================================================
-- Migration: feature attachments (HTML prototypes etc)
-- Roda no SQL Editor do Supabase.
-- ============================================================

-- Tabela que cataloga os anexos
CREATE TABLE feature_attachments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    feature_id      UUID NOT NULL REFERENCES features(id) ON DELETE CASCADE,
    filename        TEXT NOT NULL,
    content_type    TEXT NOT NULL,
    storage_path    TEXT NOT NULL,   -- path dentro do bucket
    size_bytes      INT,
    uploaded_by     UUID REFERENCES auth.users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_feature_attachments_feature ON feature_attachments(feature_id);

ALTER TABLE feature_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read attachments" ON feature_attachments
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated insert attachments" ON feature_attachments
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = uploaded_by);

ALTER PUBLICATION supabase_realtime ADD TABLE feature_attachments;

-- ============================================================
-- Bucket no Storage
-- ============================================================
-- IMPORTANTE: depois de rodar este SQL, faz isso na UI do Supabase:
--   Storage → New bucket → nome: feature-attachments → PRIVADO (não público)
--   Em Policies do bucket, cria:
--     - INSERT: authenticated com USING TRUE (qualquer usuário logado faz upload)
--     - SELECT: authenticated com USING TRUE (qualquer usuário logado lê)
