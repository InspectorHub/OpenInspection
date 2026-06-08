CREATE TABLE `sms_consent_log` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`recipient_type` text NOT NULL,
	`action` text NOT NULL,
	`disclosure_version` integer NOT NULL,
	`captured_via` text NOT NULL,
	`ip` text,
	`user_agent` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sms_consent_contact` ON `sms_consent_log` (`tenant_id`,`contact_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `sms_disclosure_versions` (
	`version` integer PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	`published_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `automation_logs` RENAME COLUMN `recipient_email` TO `recipient`;--> statement-breakpoint
ALTER TABLE `automation_logs` ADD `channel` text DEFAULT 'email' NOT NULL;--> statement-breakpoint
ALTER TABLE `automations` ADD `channels` text DEFAULT '["email"]' NOT NULL;--> statement-breakpoint
ALTER TABLE `automations` ADD `sms_body` text;--> statement-breakpoint
ALTER TABLE `tenant_configs` ADD `sms_mode` text DEFAULT 'platform' NOT NULL;