-- ============================================================
-- Migration v3: corrige RLS de stages, adiciona settings da app
-- Rode no SQL Editor do Supabase.
-- ============================================================

-- ----- Corrige stages: garante que clientes autenticados conseguem ler -----
ALTER TABLE stages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anyone read stages" ON stages;
CREATE POLICY "anyone read stages" ON stages
    FOR SELECT TO authenticated, anon USING (true);

-- ----- Configurações globais da aplicação (1 linha só) -----
CREATE TABLE IF NOT EXISTS app_settings (
    id                          INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- singleton
    auto_merge_prs              BOOLEAN NOT NULL DEFAULT false,             -- agent auto-merge depois de CI verde
    commit_to_existing_branch   BOOLEAN NOT NULL DEFAULT false,             -- commitar direto em branch principal
    auto_advance_after_pm       BOOLEAN NOT NULL DEFAULT false,             -- pular gate humano do PM
    auto_advance_after_tl       BOOLEAN NOT NULL DEFAULT false,             -- pular gate humano do TL
    default_base_branch         TEXT NOT NULL DEFAULT 'main',
    notification_slack_webhook  TEXT,
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by                  UUID REFERENCES auth.users(id)
);

-- Insere a linha singleton se não existe
INSERT INTO app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated read settings" ON app_settings;
CREATE POLICY "authenticated read settings" ON app_settings
    FOR SELECT TO authenticated USING (true);
-- Writes só via service role (orquestrador), nunca pelo cliente

-- ----- Habilita Realtime em app_settings para refletir mudanças na UI -----
ALTER PUBLICATION supabase_realtime ADD TABLE app_settings;
