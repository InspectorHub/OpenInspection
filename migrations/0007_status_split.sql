-- Additive only. The `status` enum change is type-layer (SQLite does not enforce
-- enums) and the `status` DB-level default is intentionally left unchanged to
-- AVOID a full table rebuild — `inspections` is FK-referenced and D1 cannot
-- rebuild FK-referenced tables on remote (no PRAGMA foreign_keys=OFF outside a
-- transaction). The resulting `status` default drift in `db:check` is accepted
-- (same class as the pre-existing users.role default drift; db:check is not a
-- deploy gate). New rows get 'requested' via the drizzle schema default.
ALTER TABLE `inspections` ADD COLUMN `report_status` text DEFAULT 'in_progress' NOT NULL;--> statement-breakpoint
-- Backfill report axis from the old conflated status.
UPDATE inspections SET report_status = 'published' WHERE status IN ('delivered', 'published');--> statement-breakpoint
-- Remap lifecycle axis to the 5-value set.
UPDATE inspections SET status = 'completed' WHERE status IN ('delivered', 'published', 'in_progress');--> statement-breakpoint
UPDATE inspections SET status = 'requested' WHERE status = 'draft';
