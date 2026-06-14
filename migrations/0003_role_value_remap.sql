-- 0003_role_value_remap.sql
-- Role taxonomy collapse + rename (2026-06-13). Idempotent / defensive: no-op when absent.
UPDATE users          SET role = 'manager' WHERE role = 'admin';
UPDATE tenant_invites SET role = 'manager' WHERE role = 'admin';
UPDATE users          SET role = 'manager'   WHERE role = 'office';
UPDATE tenant_invites SET role = 'manager'   WHERE role = 'office';
UPDATE users          SET role = 'inspector' WHERE role IN ('lead', 'specialist', 'apprentice');
UPDATE tenant_invites SET role = 'inspector' WHERE role IN ('lead', 'specialist', 'apprentice');
UPDATE users SET permission_overrides = '{"publish":false}'
  WHERE role = 'inspector' AND permission_overrides IS NULL
    AND id IN (SELECT id FROM users WHERE mentor_id IS NOT NULL);
