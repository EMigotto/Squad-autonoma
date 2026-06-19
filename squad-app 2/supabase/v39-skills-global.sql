-- v39: skills globais (admin) + associação global que vira padrão de novos projetos
-- agent_skills.project_id já aceita NULL (= associação global/template).
-- Postgres não força unicidade quando project_id é NULL, então criamos um
-- índice único parcial para as linhas globais.
CREATE UNIQUE INDEX IF NOT EXISTS agent_skills_global_unique
  ON agent_skills (agent_role, skill_catalog_id)
  WHERE project_id IS NULL;

-- garante que delete de skill remove associações (FK já é ON DELETE CASCADE em v38)
-- nada a fazer aqui além do índice.
