CREATE TABLE `verify_export_attempts` (
	`key` text PRIMARY KEY NOT NULL,
	`attempts` integer NOT NULL,
	`window_ends_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_verify_export_attempts_ends` ON `verify_export_attempts` (`window_ends_at`);