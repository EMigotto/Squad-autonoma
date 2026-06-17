-- v32: app_settings deixa de ser singleton (id=1) e passa a ser por projeto.
-- A PK antiga (id INT CHECK id=1) impedia mais de um time de salvar settings.

-- 1) Garante coluna project_id
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id);

-- 2) Remove o CHECK (id = 1) e o default 1, se existirem
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'app_settings'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%id = 1%' LIMIT 1;
  IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE app_settings DROP CONSTRAINT %I', c); END IF;
END $$;
ALTER TABLE app_settings ALTER COLUMN id DROP DEFAULT;

-- 3) Troca a PK de (id) para (project_id). Primeiro popula project_id da linha singleton, se órfã.
DO $$
DECLARE pk text;
BEGIN
  SELECT conname INTO pk FROM pg_constraint
   WHERE conrelid = 'app_settings'::regclass AND contype = 'p' LIMIT 1;
  IF pk IS NOT NULL THEN EXECUTE format('ALTER TABLE app_settings DROP CONSTRAINT %I', pk); END IF;
END $$;

-- linhas sem project_id viram lixo do singleton: remove as órfãs duplicadas
DELETE FROM app_settings WHERE project_id IS NULL;

-- garante unicidade por projeto e define como chave
ALTER TABLE app_settings ADD CONSTRAINT app_settings_project_unique UNIQUE (project_id);

-- id deixa de importar; mantém a coluna mas autopreenchida
ALTER TABLE app_settings ALTER COLUMN id DROP NOT NULL;
