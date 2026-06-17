-- v33: SSO corporativo (por projeto/org) + identidade Git por usuário

-- 1) Config de SSO por projeto (org). Guarda metadados; o IdP real é
--    configurado no Supabase Auth (SAML/OIDC). Aqui registramos que o time
--    exige SSO e qual domínio/َprovedor, para forçar o fluxo no login.
CREATE TABLE IF NOT EXISTS sso_config (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  enabled       BOOLEAN NOT NULL DEFAULT false,
  provider      TEXT,                 -- 'saml' | 'oidc' | 'google' | 'azure' ...
  domain        TEXT,                 -- domínio corporativo (ex: cielo.com.br)
  sso_provider_id TEXT,               -- id do provider no Supabase Auth (SSO)
  metadata_url  TEXT,                 -- SAML metadata URL (informativo)
  enforce       BOOLEAN NOT NULL DEFAULT true,  -- exigir SSO p/ esse domínio
  updated_by    UUID REFERENCES auth.users(id),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE sso_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read sso" ON sso_config;
CREATE POLICY "auth read sso" ON sso_config FOR SELECT TO authenticated USING (true);

-- 2) Identidade Git por usuário (quem escreve nos repos). Best practice:
--    NÃO usamos a senha pessoal; usamos um Personal Access Token de escopo
--    mínimo, guardado server-side e nunca exposto ao browser.
CREATE TABLE IF NOT EXISTS user_git_identity (
  user_id       UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  git_username  TEXT NOT NULL,        -- login do GitHub (ex: emigotto)
  git_email     TEXT NOT NULL,        -- e-mail usado no commit
  git_token     TEXT,                 -- PAT fine-grained (escopo: contents:write)
  token_hint    TEXT,                 -- últimos 4 chars, p/ exibição
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE user_git_identity ENABLE ROW LEVEL SECURITY;
-- cada usuário só lê/escreve a própria identidade (o token nunca volta pro front)
DROP POLICY IF EXISTS "own git identity read" ON user_git_identity;
CREATE POLICY "own git identity read" ON user_git_identity
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- 3) Registro do que foi selecionado na criação da feature (auditoria no card)
ALTER TABLE features ADD COLUMN IF NOT EXISTS selection_meta JSONB;
