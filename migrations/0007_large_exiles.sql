ALTER TABLE `tenant_configs` ADD `default_locale` text DEFAULT 'en-US' NOT NULL;--> statement-breakpoint
ALTER TABLE `tenant_configs` ADD `currency` text DEFAULT 'USD' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `locale` text;