CREATE TABLE `calendar_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`auth_type` text NOT NULL,
	`credentials_enc` text NOT NULL,
	`credentials_dek_enc` text NOT NULL,
	`capabilities` text NOT NULL,
	`calendar_id` text NOT NULL,
	`connected_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_calendar_connections_user_provider` ON `calendar_connections` (`user_id`,`provider`);--> statement-breakpoint
CREATE INDEX `idx_calendar_connections_tenant_user` ON `calendar_connections` (`tenant_id`,`user_id`);--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `google_refresh_token`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `google_calendar_id`;