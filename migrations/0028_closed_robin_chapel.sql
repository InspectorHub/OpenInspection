-- Move results and versions onto reports.
--
-- Statement order is load-bearing and is NOT what db:generate emitted. Drizzle
-- put `DROP INDEX uq_results_inspection` first, which opens a window in which
-- two results rows can be written for one inspection. The order here is:
--
--   1. add both columns
--   2. backfill (create one primary report per inspection, re-point both tables)
--   3. create the new unique indexes
--   4. only then drop the old ones
--
-- The backfill derives each report id from its inspection id rather than
-- generating one, so it is idempotent and re-runnable, and so a row can be
-- traced back to what produced it. Titles are generic on purpose: `reports.title`
-- is anonymised by the erasure manifest because it usually carries an address,
-- and a backfill should not invent PII that was not there.

ALTER TABLE `inspection_results` ADD `report_id` text;--> statement-breakpoint
ALTER TABLE `report_versions` ADD `report_id` text;--> statement-breakpoint

INSERT INTO `reports` (`id`, `tenant_id`, `inspection_id`, `kind`, `inspection_service_id`, `template_id`, `title`, `status`, `created_at`)
SELECT 'rpt-' || i.`id`,
       i.`tenant_id`,
       i.`id`,
       'primary',
       NULL,
       i.`template_id`,
       'Inspection Report',
       CASE WHEN EXISTS (SELECT 1 FROM `report_versions` rv WHERE rv.`inspection_id` = i.`id`)
            THEN 'published' ELSE 'in_progress' END,
       unixepoch() * 1000
FROM `inspections` i
WHERE NOT EXISTS (
    SELECT 1 FROM `reports` r WHERE r.`inspection_id` = i.`id` AND r.`kind` = 'primary'
);--> statement-breakpoint

UPDATE `inspection_results` SET `report_id` = 'rpt-' || `inspection_id` WHERE `report_id` IS NULL;--> statement-breakpoint
UPDATE `report_versions` SET `report_id` = 'rpt-' || `inspection_id` WHERE `report_id` IS NULL;--> statement-breakpoint

CREATE UNIQUE INDEX `uq_results_report` ON `inspection_results` (`report_id`);--> statement-breakpoint
CREATE INDEX `idx_report_versions_report` ON `report_versions` (`report_id`,`version_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_report_versions_report_version` ON `report_versions` (`report_id`,`version_number`);--> statement-breakpoint

DROP INDEX `uq_results_inspection`;--> statement-breakpoint
DROP INDEX `idx_report_versions_inspection`;--> statement-breakpoint
DROP INDEX `uq_report_versions_inspection_version`;
