-- v36: features podem ser do tipo "bug" (correção), com contexto de erro e
-- vínculo a uma issue do GitHub que é fechada quando o bug é resolvido.
ALTER TABLE features ADD COLUMN IF NOT EXISTS feature_type TEXT NOT NULL DEFAULT 'feature'; -- 'feature' | 'bug'
ALTER TABLE features ADD COLUMN IF NOT EXISTS bug_context JSONB;        -- { error, file, repro, branch }
ALTER TABLE features ADD COLUMN IF NOT EXISTS github_issue_number INT;  -- issue criada para o bug
