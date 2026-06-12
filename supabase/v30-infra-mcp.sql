-- v30: conexão com o MCP de DevOps (provisionamento de infraestrutura)
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS infra_mcp_url TEXT;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS infra_mcp_token TEXT;
