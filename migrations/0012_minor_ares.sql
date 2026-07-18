CREATE TABLE `calendar_connection_read_calendars` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`external_calendar_id` text NOT NULL,
	`summary` text,
	`access_role` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_conn_read_cal` ON `calendar_connection_read_calendars` (`connection_id`,`external_calendar_id`);--> statement-breakpoint
CREATE INDEX `idx_conn_read_cal_tenant` ON `calendar_connection_read_calendars` (`tenant_id`,`connection_id`);