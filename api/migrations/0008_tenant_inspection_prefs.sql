-- 0008_tenant_inspection_prefs.sql
-- Workflow shortcuts PR — tenant-level inspector editor preferences
-- stored as JSON: { cloneDefault, autoAdvanceDelayMs, pinnedTagIds }
ALTER TABLE tenant_configs ADD COLUMN inspection_prefs TEXT;
