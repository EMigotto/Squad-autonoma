-- v37: verificação de integração + preview de execução por feature
ALTER TABLE features ADD COLUMN IF NOT EXISTS integration_status TEXT;   -- null | running | passed | failed
ALTER TABLE features ADD COLUMN IF NOT EXISTS integration_report TEXT;   -- resumo do verificador
ALTER TABLE features ADD COLUMN IF NOT EXISTS preview_url TEXT;          -- URL pro PM abrir
ALTER TABLE features ADD COLUMN IF NOT EXISTS preview_status TEXT;       -- null | building | ready | failed

-- chaves de preview/deploy em app_settings (Vercel deploy hook + token)
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS vercel_deploy_hook TEXT;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS vercel_token TEXT;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS preview_base_url TEXT;
