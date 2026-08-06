CREATE TABLE `calendar_external_links` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`external_id` text NOT NULL,
	`etag` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_calendar_external_links_entity` ON `calendar_external_links` (`tenant_id`,`provider`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_calendar_external_links_user` ON `calendar_external_links` (`tenant_id`,`user_id`,`provider`);