-- 0005_inspection_auto_sign.sql
-- Spec 5H D2 — per-inspection toggle and tenant-level default for
-- automatically applying the inspector's saved signature at publish time.
ALTER TABLE inspections ADD COLUMN auto_sign_on_publish INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tenant_configs ADD COLUMN auto_sign_on_publish_default INTEGER NOT NULL DEFAULT 0;
