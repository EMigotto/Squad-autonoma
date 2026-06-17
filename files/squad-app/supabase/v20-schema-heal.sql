-- ============================================================
-- Schema heal (v20): garante todas as colunas que o app espera hoje
-- em app_settings e project_repositories. Idempotente — pode rodar
-- com segurança mesmo se algumas (ou todas) já existirem.
-- Use isto quando aparecer "Could not find the '<col>' column of
-- '<table>' in the schema cache".
-- ============================================================

-- app_settings: revisão reforçada (v15)
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS require_reinforced_review BOOLEAN DEFAULT false;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS sensitive_paths TEXT;

-- app_settings: notificações (v17)
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS notification_teams_webhook TEXT;

-- app_settings: indicadores e custos (v12)
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS human_hourly_cost      NUMERIC DEFAULT 0;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS token_cost_input_mtok  NUMERIC DEFAULT 0;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS token_cost_output_mtok NUMERIC DEFAULT 0;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS metrics_currency       TEXT DEFAULT 'BRL';

-- project_repositories: dependências e papel (v15)
ALTER TABLE project_repositories ADD COLUMN IF NOT EXISTS depends_on  TEXT;
ALTER TABLE project_repositories ADD COLUMN IF NOT EXISTS description TEXT;

-- project_repositories: config de aplicação (v18 — agora vive na Aplicação)
ALTER TABLE project_repositories ADD COLUMN IF NOT EXISTS app_type          TEXT DEFAULT 'new';
ALTER TABLE project_repositories ADD COLUMN IF NOT EXISTS app_kind          TEXT;
ALTER TABLE project_repositories ADD COLUMN IF NOT EXISTS tech_stack        TEXT;
ALTER TABLE project_repositories ADD COLUMN IF NOT EXISTS instructions_path TEXT DEFAULT 'CLAUDE.md';

-- Conferência (deve voltar tudo not null):
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name='app_settings'
--   AND column_name IN ('require_reinforced_review','sensitive_paths',
--                       'notification_teams_webhook','human_hourly_cost',
--                       'token_cost_input_mtok','token_cost_output_mtok',
--                       'metrics_currency');
