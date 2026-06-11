-- ============================================================
-- Migration v17: Webhook do Microsoft Teams (notificação de etapas)
-- ============================================================
-- A cada etapa concluída na esteira, notifica um grupo no Teams.
-- (Os webhooks clássicos do Teams foram descontinuados; usar a URL gerada
--  pelo app "Workflows" do Teams — "Post to a channel when a webhook request
--  is received". O payload enviado é um Adaptive Card.)
-- ============================================================

ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS notification_teams_webhook TEXT;
