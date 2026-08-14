-- The index the dashboard list has always needed, and two that never did anything.
--
-- `inspections` carried seven indexes and NOT ONE of them started with
-- `created_at`, while the list query filters by tenant and orders by
-- `(created_at DESC, id DESC)` — which is also its cursor key. EXPLAIN QUERY
-- PLAN, against a database built from `0000_baseline.sql`:
--
--   before                        SEARCH i USING INDEX idx_inspections_tenant_date (tenant_id=?)
--                                 USE TEMP B-TREE FOR ORDER BY
--   with (tenant_id, created_at)  USE TEMP B-TREE FOR RIGHT PART OF ORDER BY
--   with (tenant_id, created_at, id)   SEARCH i USING INDEX … (tenant_id=?)   -- no sort at all
--
-- So `id` is in the key deliberately: it is the tie-break half of the cursor,
-- and without it the planner still sorts.
CREATE INDEX `idx_inspections_tenant_created` ON `inspections` (`tenant_id`,`created_at`,`id`);--> statement-breakpoint

-- Two indexes whose column lists are IDENTICAL to a unique index sitting beside
-- them on the same table. A unique index is a b-tree like any other and serves
-- every read the non-unique twin could, so each of these only ever cost a
-- second write per row — which on D1 is billed.
--
-- These are the two exact duplicates. The audit that found them also found
-- seventeen indexes that are a strict PREFIX of a wider one on the same table
-- (`idx_inspections_tenant` is now one of them, covered by the index above).
-- Those are left alone here: a narrower index is cheaper to scan and the
-- planner sometimes prefers it, so dropping them is a measurement, not a
-- deduction. Nothing about these two is a judgement call.
DROP INDEX `idx_tenant_custom_holidays_tenant_date`;--> statement-breakpoint
DROP INDEX `idx_report_versions_report`;
