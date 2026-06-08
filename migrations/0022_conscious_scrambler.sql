CREATE TABLE `erasure_log` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`subject_email` text NOT NULL,
	`requested_by` text,
	`identity_basis` text,
	`status` text NOT NULL,
	`decisions_json` text NOT NULL,
	`retained_count` integer DEFAULT 0 NOT NULL,
	`anonymized_count` integer DEFAULT 0 NOT NULL,
	`deleted_count` integer DEFAULT 0 NOT NULL,
	`response_note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_erasure_log_tenant` ON `erasure_log` (`tenant_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `tenant_configs` ADD `agreement_retention_years` integer DEFAULT 6 NOT NULL;