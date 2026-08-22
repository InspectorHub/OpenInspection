CREATE TABLE `statutory_form_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`form_id` text NOT NULL,
	`version` text NOT NULL,
	`effective_from` integer NOT NULL,
	`mandatory_from` integer,
	`effective_until` integer,
	`source_url` text NOT NULL,
	`source_hash` text NOT NULL,
	`object_key` text NOT NULL,
	`published_by` text NOT NULL,
	`published_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_statutory_form_versions_form_version` ON `statutory_form_versions` (`form_id`,`version`);--> statement-breakpoint
CREATE INDEX `idx_statutory_form_versions_form` ON `statutory_form_versions` (`form_id`,`effective_from`);