-- 0002_role_value_remap.sql
-- Role taxonomy collapse + rename (2026-06-13). Idempotent / defensive:
-- a no-op when the legacy values are absent.
--
-- 1) admin -> manager (the rename).
UPDATE users          SET role = 'manager' WHERE role = 'admin';
UPDATE tenant_invites SET role = 'manager' WHERE role = 'admin';
--
-- 2) Dropped subsystem-C roles collapse to the 4 canonical roles.
--    office -> manager (back-office); lead/specialist/apprentice -> inspector.
UPDATE users          SET role = 'manager'   WHERE role = 'office';
UPDATE tenant_invites SET role = 'manager'   WHERE role = 'office';
UPDATE users          SET role = 'inspector' WHERE role IN ('lead', 'specialist', 'apprentice');
UPDATE tenant_invites SET role = 'inspector' WHERE role IN ('lead', 'specialist', 'apprentice');
--
-- 3) Preserve apprentice "requires review" semantics: any former apprentice keeps
--    review-on-publish via a permission override (publish=false). Only sets the
--    override when the column is currently NULL so we never clobber explicit prefs.
UPDATE users SET permission_overrides = '{"publish":false}'
  WHERE role = 'inspector' AND permission_overrides IS NULL
    AND id IN (SELECT id FROM users WHERE mentor_id IS NOT NULL);
