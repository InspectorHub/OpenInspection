CREATE TABLE `email_suppressions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`email` text NOT NULL,
	`reason` text NOT NULL,
	`source_provider` text NOT NULL,
	`provider_event_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_email_suppressions_email` ON `email_suppressions` (`tenant_id`,`email`);