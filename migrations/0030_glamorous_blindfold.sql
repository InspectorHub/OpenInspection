ALTER TABLE `inspections` ADD `reports_generated_at` integer;--> statement-breakpoint
ALTER TABLE `reports` ADD `published_at` integer;--> statement-breakpoint
ALTER TABLE `reports` ADD `notified_at` integer;--> statement-breakpoint
ALTER TABLE `reports` ADD `sort_order` integer DEFAULT 0 NOT NULL;