-- v35: conceito de SUPER ADMIN da plataforma (separado de owner de time) +
-- define eduardo.migotto@cielo.com.br como super admin.

CREATE TABLE IF NOT EXISTS platform_admins (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read admins" ON platform_admins;
CREATE POLICY "auth read admins" ON platform_admins FOR SELECT TO authenticated USING (true);

-- Define o usuário atual como super admin (resolve o id pelo e-mail em auth.users)
INSERT INTO platform_admins (user_id, email)
SELECT id, email FROM auth.users
 WHERE lower(email) = 'eduardo.migotto@cielo.com.br'
ON CONFLICT (user_id) DO NOTHING;

-- View de atividade da plataforma (logins + cadastro), agregando perfil e times.
-- SECURITY: exposta só via service role nos endpoints /api/admin/*.
CREATE OR REPLACE VIEW platform_activity AS
SELECT
  u.id              AS user_id,
  u.email,
  p.name            AS display_name,
  u.created_at      AS signed_up_at,
  u.last_sign_in_at,
  (SELECT count(*) FROM teams t WHERE t.created_by = u.id)      AS teams_created,
  (SELECT count(*) FROM projects pr WHERE pr.created_by = u.id) AS projects_created,
  (SELECT count(*) FROM team_members tm WHERE tm.user_id = u.id) AS team_memberships
FROM auth.users u
LEFT JOIN user_profiles p ON p.id = u.id;
