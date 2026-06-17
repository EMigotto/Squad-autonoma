-- v38: catálogo de Skills (marketplace) + associação aos agentes
-- Skills são pacotes filesystem (SKILL.md + recursos) que o agente invoca sob
-- demanda. Tipos: 'anthropic' (pré-build: xlsx/docx/pptx/pdf) e 'custom'
-- (enviadas ao workspace via Skills API; referenciadas por skill_id+version).

CREATE TABLE IF NOT EXISTS skills_catalog (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID REFERENCES projects(id) ON DELETE CASCADE,
  source        TEXT NOT NULL DEFAULT 'custom',  -- 'anthropic' | 'custom'
  skill_id      TEXT NOT NULL,                   -- id no workspace (ex: skill_abc) ou short name (xlsx)
  name          TEXT NOT NULL,
  description   TEXT,
  version       TEXT DEFAULT 'latest',
  capability    TEXT,                            -- capacidade/tag (ex: "planilhas", "ppt", "auditoria")
  created_by    UUID REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE skills_catalog ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read skills" ON skills_catalog;
CREATE POLICY "auth read skills" ON skills_catalog FOR SELECT TO authenticated USING (true);

-- associação skill <-> papel do agente (por projeto)
CREATE TABLE IF NOT EXISTS agent_skills (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID REFERENCES projects(id) ON DELETE CASCADE,
  agent_role    TEXT NOT NULL,
  skill_catalog_id UUID REFERENCES skills_catalog(id) ON DELETE CASCADE,
  enabled       BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, agent_role, skill_catalog_id)
);
ALTER TABLE agent_skills ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read agent_skills" ON agent_skills;
CREATE POLICY "auth read agent_skills" ON agent_skills FOR SELECT TO authenticated USING (true);

-- semeia as 4 skills pré-build da Anthropic (globais; project_id NULL)
INSERT INTO skills_catalog (source, skill_id, name, description, capability, project_id)
SELECT * FROM (VALUES
  ('anthropic','xlsx','Excel (xlsx)','Criar e editar planilhas','planilhas',NULL::uuid),
  ('anthropic','docx','Word (docx)','Criar e editar documentos Word','documentos',NULL::uuid),
  ('anthropic','pptx','PowerPoint (pptx)','Criar apresentações','apresentações',NULL::uuid),
  ('anthropic','pdf','PDF','Criar e preencher PDFs','pdf',NULL::uuid)
) AS v(source,skill_id,name,description,capability,project_id)
WHERE NOT EXISTS (SELECT 1 FROM skills_catalog s WHERE s.skill_id = v.skill_id AND s.source='anthropic');
