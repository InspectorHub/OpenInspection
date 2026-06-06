CREATE TABLE `inspection_inspectors` (
	`inspection_id` text NOT NULL,
	`user_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`role` text DEFAULT 'lead' NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`inspection_id`, `user_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_insp_inspectors_tenant_user` ON `inspection_inspectors` (`tenant_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_insp_inspectors_user` ON `inspection_inspectors` (`user_id`);--> statement-breakpoint
CREATE TABLE `service_inspectors` (
	`service_id` text NOT NULL,
	`user_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`service_id`, `user_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_service_inspectors_tenant` ON `service_inspectors` (`tenant_id`);--> statement-breakpoint
ALTER TABLE `tenant_configs` ADD `allow_inspector_choice` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- MIN(id) on a TEXT primary key is arbitrary-but-deterministic (lexicographic order), not insertion order.
DELETE FROM `availability` WHERE `id` NOT IN (
  SELECT MIN(`id`) FROM `availability` GROUP BY `inspector_id`, `day_of_week`, `start_time`
);
--> statement-breakpoint
-- MIN(id) on a TEXT primary key is arbitrary-but-deterministic (lexicographic order), not insertion order.
DELETE FROM `availability_overrides` WHERE `is_available` = 0 AND `id` NOT IN (
  SELECT MIN(`id`) FROM `availability_overrides` WHERE `is_available` = 0 GROUP BY `inspector_id`, `date`
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_availability_window_unique` ON `availability` (`inspector_id`,`day_of_week`,`start_time`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_avail_overrides_block_unique` ON `availability_overrides` (`inspector_id`,`date`) WHERE is_available = 0;
--> statement-breakpoint
INSERT OR IGNORE INTO `inspection_inspectors` (`inspection_id`, `user_id`, `tenant_id`, `role`, `created_at`)
SELECT `id`, COALESCE(`lead_inspector_id`, `inspector_id`), `tenant_id`, 'lead', strftime('%s','now') * 1000
FROM `inspections` WHERE COALESCE(`lead_inspector_id`, `inspector_id`) IS NOT NULL;
--> statement-breakpoint
INSERT OR IGNORE INTO `inspection_inspectors` (`inspection_id`, `user_id`, `tenant_id`, `role`, `created_at`)
SELECT i.`id`, je.`value`, i.`tenant_id`, 'helper', strftime('%s','now') * 1000
FROM `inspections` i, json_each(CASE WHEN json_valid(i.`helper_inspector_ids`) THEN i.`helper_inspector_ids` ELSE '[]' END) je
WHERE je.`value` IS NOT NULL
AND (COALESCE(i.`lead_inspector_id`, i.`inspector_id`) IS NULL OR je.`value` <> COALESCE(i.`lead_inspector_id`, i.`inspector_id`));
