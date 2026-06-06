CREATE TABLE `parked_cmd_events` (
	`id` text PRIMARY KEY NOT NULL,
	`envelope` text NOT NULL,
	`reason` text NOT NULL,
	`received_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_parked_cmd_events_received_at` ON `parked_cmd_events` (`received_at`);--> statement-breakpoint
CREATE TABLE `processed_cmd_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`cmd_type` text NOT NULL,
	`processed_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `tenants` ADD `applied_cmd_seq` integer DEFAULT 0 NOT NULL;