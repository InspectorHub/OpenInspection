CREATE TABLE `orphaned_media` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`inspection_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`first_seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_orphaned_media_key` ON `orphaned_media` (`tenant_id`,`r2_key`);