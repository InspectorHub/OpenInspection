ALTER TABLE `tenant_configs` ADD `date_format` text DEFAULT 'us' NOT NULL;--> statement-breakpoint
ALTER TABLE `tenant_configs` ADD `time_format` text DEFAULT '12h' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `date_format` text;--> statement-breakpoint
ALTER TABLE `users` ADD `time_format` text;