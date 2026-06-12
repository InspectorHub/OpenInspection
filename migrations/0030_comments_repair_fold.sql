ALTER TABLE `comments` ADD `repair_summary` text;--> statement-breakpoint
ALTER TABLE `comments` ADD `estimate_min_cents` integer;--> statement-breakpoint
ALTER TABLE `comments` ADD `estimate_max_cents` integer;--> statement-breakpoint
ALTER TABLE `comments` ADD `recommended_contractor_type_id` text;--> statement-breakpoint
CREATE TABLE `contractor_types` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_contractor_types_tenant` ON `contractor_types` (`tenant_id`);--> statement-breakpoint
-- Fold: copy every repair-item library row into `comments`, reusing its id so
-- existing finding snapshots (which reference recommendationId) still resolve.
-- severity feeds both rating_bucket and severity; created_at preserved verbatim
-- (NOT NULL with no default — omitting it would make INSERT OR IGNORE drop the row).
INSERT OR IGNORE INTO `comments` (`id`,`tenant_id`,`text`,`category`,`rating_bucket`,`severity`,`repair_summary`,`estimate_min_cents`,`estimate_max_cents`,`created_at`)
SELECT `id`,`tenant_id`,`name`,`category`,`severity`,`severity`,`default_repair_summary`,`default_estimate_min`,`default_estimate_max`,`created_at`
FROM `recommendations`;
--> statement-breakpoint
-- Seed the default contractor-type list into every existing tenant.
-- id = random 128-bit hex; created_at in epoch ms (timestamp_ms column).
INSERT INTO `contractor_types` (`id`,`tenant_id`,`name`,`sort_order`,`created_at`)
SELECT lower(hex(randomblob(16))), t.`id`, ct.`name`, ct.`ord`, CAST(strftime('%s','now') AS INTEGER) * 1000
FROM `tenants` t
CROSS JOIN (
  SELECT 'Licensed Electrician' AS name, 1 AS ord UNION ALL
  SELECT 'Plumber', 2 UNION ALL SELECT 'Roofer', 3 UNION ALL
  SELECT 'HVAC Technician', 4 UNION ALL SELECT 'General Contractor', 5 UNION ALL
  SELECT 'Structural Engineer', 6 UNION ALL SELECT 'Foundation Specialist', 7 UNION ALL
  SELECT 'Pest/Termite', 8 UNION ALL SELECT 'Chimney Sweep', 9 UNION ALL
  SELECT 'Grading/Drainage', 10
) ct;
--> statement-breakpoint
DROP TABLE `recommendations`;