-- B4: Per-inspection template snapshot. Freezes the template at inspection
-- creation so admin edits to the master template never disturb in-flight
-- reports. Backfill from the current template for legacy inspections.
ALTER TABLE inspections ADD COLUMN template_snapshot TEXT;
ALTER TABLE inspections ADD COLUMN template_snapshot_version INTEGER DEFAULT 1;

UPDATE inspections
SET template_snapshot = (SELECT schema FROM templates WHERE templates.id = inspections.template_id),
    template_snapshot_version = (SELECT version FROM templates WHERE templates.id = inspections.template_id)
WHERE template_snapshot IS NULL AND template_id IS NOT NULL;
