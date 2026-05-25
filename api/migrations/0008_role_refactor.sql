-- Data Migration: Refactor roles to the new Spectora-style simplified set
-- 1. Merge 'owner' into 'admin'
-- 2. Merge 'agent' and 'viewer' into 'office_staff'

UPDATE users SET role = 'admin' WHERE role = 'owner';
UPDATE users SET role = 'office_staff' WHERE role IN ('agent', 'viewer');

UPDATE tenant_invites SET role = 'admin' WHERE role = 'owner';
UPDATE tenant_invites SET role = 'office_staff' WHERE role IN ('agent', 'viewer');
