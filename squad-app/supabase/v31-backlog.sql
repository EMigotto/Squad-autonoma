-- v31: sessão BACKLOG (sem disparo) + semente de PRD por feature
ALTER TABLE features ADD COLUMN IF NOT EXISTS seed_prd TEXT;
INSERT INTO stages (code, label, sort_order, requires_role)
SELECT 'backlog', 'Backlog', -1, 'pm'
WHERE NOT EXISTS (SELECT 1 FROM stages WHERE code = 'backlog');
