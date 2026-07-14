ALTER TABLE `tenant_configs` ADD `default_timezone` text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `timezone` text;