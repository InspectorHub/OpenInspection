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
-- One plain INSERT..SELECT per type (NO compound UNION): D1 distributes a
-- `tenants CROSS JOIN (… UNION ALL …)` into a per-tenant compound SELECT and
-- trips "too many terms in compound SELECT" (SQLITE_ERROR 7500) even at a
-- handful of tenants. Separate non-compound statements sidestep the limit.
INSERT INTO `contractor_types` (`id`,`tenant_id`,`name`,`sort_order`,`created_at`)
SELECT lower(hex(randomblob(16))), t.`id`, 'Licensed Electrician', 1, CAST(strftime('%s','now') AS INTEGER) * 1000 FROM `tenants` t;--> statement-breakpoint
INSERT INTO `contractor_types` (`id`,`tenant_id`,`name`,`sort_order`,`created_at`)
SELECT lower(hex(randomblob(16))), t.`id`, 'Plumber', 2, CAST(strftime('%s','now') AS INTEGER) * 1000 FROM `tenants` t;--> statement-breakpoint
INSERT INTO `contractor_types` (`id`,`tenant_id`,`name`,`sort_order`,`created_at`)
SELECT lower(hex(randomblob(16))), t.`id`, 'Roofer', 3, CAST(strftime('%s','now') AS INTEGER) * 1000 FROM `tenants` t;--> statement-breakpoint
INSERT INTO `contractor_types` (`id`,`tenant_id`,`name`,`sort_order`,`created_at`)
SELECT lower(hex(randomblob(16))), t.`id`, 'HVAC Technician', 4, CAST(strftime('%s','now') AS INTEGER) * 1000 FROM `tenants` t;--> statement-breakpoint
INSERT INTO `contractor_types` (`id`,`tenant_id`,`name`,`sort_order`,`created_at`)
SELECT lower(hex(randomblob(16))), t.`id`, 'General Contractor', 5, CAST(strftime('%s','now') AS INTEGER) * 1000 FROM `tenants` t;--> statement-breakpoint
INSERT INTO `contractor_types` (`id`,`tenant_id`,`name`,`sort_order`,`created_at`)
SELECT lower(hex(randomblob(16))), t.`id`, 'Structural Engineer', 6, CAST(strftime('%s','now') AS INTEGER) * 1000 FROM `tenants` t;--> statement-breakpoint
INSERT INTO `contractor_types` (`id`,`tenant_id`,`name`,`sort_order`,`created_at`)
SELECT lower(hex(randomblob(16))), t.`id`, 'Foundation Specialist', 7, CAST(strftime('%s','now') AS INTEGER) * 1000 FROM `tenants` t;--> statement-breakpoint
INSERT INTO `contractor_types` (`id`,`tenant_id`,`name`,`sort_order`,`created_at`)
SELECT lower(hex(randomblob(16))), t.`id`, 'Pest/Termite', 8, CAST(strftime('%s','now') AS INTEGER) * 1000 FROM `tenants` t;--> statement-breakpoint
INSERT INTO `contractor_types` (`id`,`tenant_id`,`name`,`sort_order`,`created_at`)
SELECT lower(hex(randomblob(16))), t.`id`, 'Chimney Sweep', 9, CAST(strftime('%s','now') AS INTEGER) * 1000 FROM `tenants` t;--> statement-breakpoint
INSERT INTO `contractor_types` (`id`,`tenant_id`,`name`,`sort_order`,`created_at`)
SELECT lower(hex(randomblob(16))), t.`id`, 'Grading/Drainage', 10, CAST(strftime('%s','now') AS INTEGER) * 1000 FROM `tenants` t;--> statement-breakpoint
DROP TABLE `recommendations`;