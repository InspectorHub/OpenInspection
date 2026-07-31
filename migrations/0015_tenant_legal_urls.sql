ALTER TABLE `tenant_configs` ADD `legal_mode` text DEFAULT 'hosted' NOT NULL;--> statement-breakpoint
ALTER TABLE `tenant_configs` ADD `custom_privacy_url` text;--> statement-breakpoint
ALTER TABLE `tenant_configs` ADD `custom_terms_url` text;--> statement-breakpoint
ALTER TABLE `tenant_configs` ADD `privacy_body` text;--> statement-breakpoint
ALTER TABLE `tenant_configs` ADD `terms_body` text;
