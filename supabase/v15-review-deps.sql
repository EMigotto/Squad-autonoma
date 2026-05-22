-- ============================================================
-- Migration v15: Revisão reforçada + dependências entre repositórios
-- ============================================================

-- Passo 1: revisão reforçada para áreas sensíveis (config por projeto)
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS require_reinforced_review BOOLEAN DEFAULT false;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS sensitive_paths TEXT;

-- Passo 2: dependências entre repositórios numa feature multi-repo.
-- Cada repositório pode declarar de quais outros depende (ordem de build/deploy).
ALTER TABLE project_repositories ADD COLUMN IF NOT EXISTS depends_on TEXT; -- lista de repos/labels separados por vírgula
ALTER TABLE project_repositories ADD COLUMN IF NOT EXISTS description TEXT; -- papel do repo no projeto
