CREATE TABLE `report_translations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`report_id` text NOT NULL,
	`locale` text NOT NULL,
	`content` text NOT NULL,
	`source` text NOT NULL,
	`english_hash` text NOT NULL,
	`translated_hash` text NOT NULL,
	`notice_version` integer NOT NULL,
	`ai_call_id` text NOT NULL,
	`generated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_report_translations_report_locale` ON `report_translations` (`tenant_id`,`report_id`,`locale`);