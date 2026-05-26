-- ============================================================
-- Migration v16: Token de acesso MCP por desenvolvedor (Fase 1 — leitura)
-- ============================================================
-- Cada usuário gera um token usado pelo Claude Code (header Authorization)
-- para acessar o conector MCP da Squad em modo leitura.
-- ============================================================

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS mcp_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_mcp_token
    ON user_profiles(mcp_token) WHERE mcp_token IS NOT NULL;
