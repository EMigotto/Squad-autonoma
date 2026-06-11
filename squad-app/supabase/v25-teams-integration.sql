-- ============================================================
-- Migration v25: Integração Microsoft Teams (comandos + chat do time)
-- ============================================================
-- teams_command_token: segredo por time que autentica comandos vindos do
--   Teams (criar feature, aprovar/reprovar etapa). Gerado ao configurar.
-- teams_chat_link: deep link do chat/canal do time no Teams (para o botão
--   "abrir chat do time").
-- Idempotente.
-- ============================================================
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS teams_command_token TEXT;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS teams_chat_link TEXT;
