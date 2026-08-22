CREATE TABLE `statutory_form_sightings` (
	`id` text PRIMARY KEY NOT NULL,
	`form_id` text NOT NULL,
	`source_url` text NOT NULL,
	`observed_hash` text NOT NULL,
	`verdict` text NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_statutory_form_sightings_seen` ON `statutory_form_sightings` (`form_id`,`source_url`,`observed_hash`);--> statement-breakpoint
CREATE INDEX `idx_statutory_form_sightings_form` ON `statutory_form_sightings` (`form_id`,`last_seen_at`);