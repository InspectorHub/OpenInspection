ALTER TABLE `tenant_configs` ADD `email_mode` text DEFAULT 'platform' NOT NULL;--> statement-breakpoint
ALTER TABLE `tenant_configs` ADD `sender_display_name` text;--> statement-breakpoint
ALTER TABLE `tenant_configs` ADD `use_inspector_from_name` integer DEFAULT false NOT NULL;