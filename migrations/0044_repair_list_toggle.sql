-- Track E1 (ITB §11, UC-ITB-07) — opt-in Repair List view.
--
-- When enable_repair_list = 1, the published report sub-nav exposes an
-- additional "Repair List" tab that aggregates every defect-rated item
-- across the inspection into a clean punch-list (item label + comment +
-- contractor recommendation tag + estimate range + photos). Distinct from
-- the narrative report — this is what realtors hand to contractors.
--
-- Defaults to 0 so existing tenants don't see the new tab until they
-- explicitly opt in via Settings → Workspace → Reports.

ALTER TABLE tenant_configs ADD COLUMN enable_repair_list INTEGER NOT NULL DEFAULT 0;
