-- v34: SSO passa a ser GLOBAL (da aplicação como um todo), não por time.
-- Tabela singleton (uma linha) administrada por owners.

CREATE TABLE IF NOT EXISTS app_sso_config (
  id              INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled         BOOLEAN NOT NULL DEFAULT false,
  provider        TEXT,
  domain          TEXT,
  sso_provider_id TEXT,
  metadata_url    TEXT,
  enforce         BOOLEAN NOT NULL DEFAULT true,
  updated_by      UUID REFERENCES auth.users(id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE app_sso_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read global sso" ON app_sso_config;
CREATE POLICY "auth read global sso" ON app_sso_config FOR SELECT TO authenticated USING (true);

-- migra a config que porventura existisse por projeto (pega a mais recente)
INSERT INTO app_sso_config (id, enabled, provider, domain, sso_provider_id, metadata_url, enforce, updated_at)
SELECT 1, enabled, provider, domain, sso_provider_id, metadata_url, enforce, updated_at
  FROM sso_config
 ORDER BY updated_at DESC
 LIMIT 1
ON CONFLICT (id) DO NOTHING;
