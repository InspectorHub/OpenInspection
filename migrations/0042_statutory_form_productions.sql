CREATE TABLE `statutory_form_productions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`inspection_id` text NOT NULL,
	`form_id` text NOT NULL,
	`version` text NOT NULL,
	`source_hash` text NOT NULL,
	`produced_by` text NOT NULL,
	`produced_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_statutory_productions_form_version` ON `statutory_form_productions` (`form_id`,`version`);--> statement-breakpoint
CREATE INDEX `idx_statutory_productions_inspection` ON `statutory_form_productions` (`tenant_id`,`inspection_id`);