CREATE TABLE `report_views` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`inspection_id` text NOT NULL,
	`access_token_id` text NOT NULL,
	`first_viewed_at` integer,
	`last_viewed_at` integer,
	`view_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_report_views_scope` ON `report_views` (`tenant_id`,`inspection_id`,`access_token_id`);--> statement-breakpoint
ALTER TABLE `inspection_access_tokens` ADD `view_tracking_objected_at` integer;--> statement-breakpoint
ALTER TABLE `tenant_configs` ADD `repair_quick_phrases` text;