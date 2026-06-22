-- v41: arquivamento de cards + tipo de funcionalidade + repo backend (fullstack)

-- Arquivar cards (não polui a coluna Concluído)
ALTER TABLE cards ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- Tipo de funcionalidade da feature (frontend, fullstack, api, batch, etc.)
ALTER TABLE features ADD COLUMN IF NOT EXISTS functionality_type TEXT DEFAULT 'fullstack';

-- Para fullstack com repos/diretórios separados de front e back
ALTER TABLE features ADD COLUMN IF NOT EXISTS frontend_path TEXT;          -- diretório do front no repo principal
ALTER TABLE features ADD COLUMN IF NOT EXISTS backend_github_repo TEXT;    -- repo do backend (se separado)
ALTER TABLE features ADD COLUMN IF NOT EXISTS backend_repository_id UUID REFERENCES project_repositories(id);
ALTER TABLE features ADD COLUMN IF NOT EXISTS backend_path TEXT;           -- diretório do back
ALTER TABLE features ADD COLUMN IF NOT EXISTS backend_branch TEXT;         -- branch do backend (se separado)
