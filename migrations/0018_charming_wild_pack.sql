CREATE TABLE `notification_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`subject_kind` text NOT NULL,
	`subject_id` text NOT NULL,
	`class_id` text NOT NULL,
	`channel` text NOT NULL,
	`enabled` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_notification_prefs_unique` ON `notification_preferences` (`tenant_id`,`subject_kind`,`subject_id`,`class_id`,`channel`);--> statement-breakpoint
CREATE INDEX `idx_notification_prefs_subject` ON `notification_preferences` (`tenant_id`,`subject_kind`,`subject_id`);