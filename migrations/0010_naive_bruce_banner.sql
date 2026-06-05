CREATE TABLE `tenant_destruction_records` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`tenant_slug` text,
	`rows_deleted` integer DEFAULT 0 NOT NULL,
	`r2_objects` integer DEFAULT 0 NOT NULL,
	`r2_bytes` integer DEFAULT 0 NOT NULL,
	`kv_keys` integer DEFAULT 0 NOT NULL,
	`destroyed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_destruction_tenant` ON `tenant_destruction_records` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_destruction_destroyed_at` ON `tenant_destruction_records` (`destroyed_at`);