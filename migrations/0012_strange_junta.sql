-- DB-1 pre-clean: collapse duplicate result rows (keep the freshest) so the
-- unique index can build. No-op when no duplicates exist.
DELETE FROM inspection_results WHERE rowid NOT IN (
  SELECT MAX(rowid) FROM inspection_results GROUP BY inspection_id
);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_results_inspection` ON `inspection_results` (`inspection_id`);