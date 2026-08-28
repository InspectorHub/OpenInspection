CREATE TABLE `statutory_form_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`inspection_id` text NOT NULL,
	`form_id` text NOT NULL,
	`values` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_statutory_form_entries_subject` ON `statutory_form_entries` (`tenant_id`,`inspection_id`,`form_id`);--> statement-breakpoint
CREATE INDEX `idx_statutory_form_entries_inspection` ON `statutory_form_entries` (`tenant_id`,`inspection_id`);