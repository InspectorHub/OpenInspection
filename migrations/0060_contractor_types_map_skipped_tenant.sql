-- Map the contractor types of the one tenant the original trade_slug backfill
-- skipped. Five of its rows carry names matching the canonical labels exactly,
-- so this was a skipped tenant rather than a name mismatch. There is no backfill
-- in the repository at all -- whatever mapped the other 120 rows ran outside
-- version control -- so this one is written down and idempotent.
--
-- Keyed on name AND a NULL slug, so a re-run is a no-op and no mapping that
-- already exists can be overwritten.
--
-- Each statement additionally refuses to create a duplicate.
-- `uq_contractor_types_tenant_trade` is unique on (tenant_id, trade_slug) over
-- non-NULL slugs, and the schema states that collision is deliberate: a backfill
-- must FAIL rather than silently duplicate. A workspace holding both a slugged
-- `Licensed Plumber` and a hand-created `Plumber` would put two rows on one
-- (tenant_id, 'licensed-plumber'). Production is safe because every tenant still
-- carries the untouched 10-row seed, but a self-hosted install has arbitrary
-- tenant-authored names and no such guarantee -- and there the failure is not a
-- bad row: the migration aborts and blocks every later migration in the chain.
--
-- `Foundation Specialist` and `Grading/Drainage` are deliberately absent below.
-- They are the two EXTRA seeds with no counterpart in the canonical vocabulary;
-- NULL is their permanent, correct state.
UPDATE contractor_types SET trade_slug = 'licensed-electrician'
 WHERE trade_slug IS NULL AND name = 'Licensed Electrician'
   AND NOT EXISTS (SELECT 1 FROM contractor_types x WHERE x.tenant_id = contractor_types.tenant_id AND x.trade_slug = 'licensed-electrician');
--> statement-breakpoint
UPDATE contractor_types SET trade_slug = 'licensed-plumber'
 WHERE trade_slug IS NULL AND name = 'Plumber'
   AND NOT EXISTS (SELECT 1 FROM contractor_types x WHERE x.tenant_id = contractor_types.tenant_id AND x.trade_slug = 'licensed-plumber');
--> statement-breakpoint
UPDATE contractor_types SET trade_slug = 'licensed-roofer'
 WHERE trade_slug IS NULL AND name = 'Roofer'
   AND NOT EXISTS (SELECT 1 FROM contractor_types x WHERE x.tenant_id = contractor_types.tenant_id AND x.trade_slug = 'licensed-roofer');
--> statement-breakpoint
UPDATE contractor_types SET trade_slug = 'hvac-technician'
 WHERE trade_slug IS NULL AND name = 'HVAC Technician'
   AND NOT EXISTS (SELECT 1 FROM contractor_types x WHERE x.tenant_id = contractor_types.tenant_id AND x.trade_slug = 'hvac-technician');
--> statement-breakpoint
UPDATE contractor_types SET trade_slug = 'general-contractor'
 WHERE trade_slug IS NULL AND name = 'General Contractor'
   AND NOT EXISTS (SELECT 1 FROM contractor_types x WHERE x.tenant_id = contractor_types.tenant_id AND x.trade_slug = 'general-contractor');
--> statement-breakpoint
UPDATE contractor_types SET trade_slug = 'structural-engineer'
 WHERE trade_slug IS NULL AND name = 'Structural Engineer'
   AND NOT EXISTS (SELECT 1 FROM contractor_types x WHERE x.tenant_id = contractor_types.tenant_id AND x.trade_slug = 'structural-engineer');
--> statement-breakpoint
UPDATE contractor_types SET trade_slug = 'chimney-sweep'
 WHERE trade_slug IS NULL AND name = 'Chimney Sweep'
   AND NOT EXISTS (SELECT 1 FROM contractor_types x WHERE x.tenant_id = contractor_types.tenant_id AND x.trade_slug = 'chimney-sweep');
--> statement-breakpoint
UPDATE contractor_types SET trade_slug = 'pest-control'
 WHERE trade_slug IS NULL AND name = 'Pest/Termite'
   AND NOT EXISTS (SELECT 1 FROM contractor_types x WHERE x.tenant_id = contractor_types.tenant_id AND x.trade_slug = 'pest-control');

-- A tenant skipped by the NOT EXISTS guard above is not silently fine: it holds
-- two types for one trade and this migration declined to choose between them.
-- Run this afterwards to see them -- a bare SELECT inside the migration would be
-- silence dressed as a report, because `wrangler d1 migrations apply` does not
-- surface result sets.
--
--   SELECT tenant_id, name FROM contractor_types
--    WHERE trade_slug IS NULL
--      AND name IN ('Licensed Electrician','Plumber','Roofer','HVAC Technician',
--                   'General Contractor','Structural Engineer','Chimney Sweep','Pest/Termite');
