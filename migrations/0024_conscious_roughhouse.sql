ALTER TABLE `automations` ADD `conditions` text;--> statement-breakpoint
ALTER TABLE `automations` ADD `channel` text DEFAULT 'email' NOT NULL;--> statement-breakpoint
ALTER TABLE `tenant_configs` ADD `review_url` text;