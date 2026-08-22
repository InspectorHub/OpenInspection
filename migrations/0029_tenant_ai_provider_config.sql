ALTER TABLE `tenant_configs` ADD `is_ai_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `tenant_configs` ADD `ai_provider_kind` text;--> statement-breakpoint
ALTER TABLE `tenant_configs` ADD `ai_base_url` text;--> statement-breakpoint
ALTER TABLE `tenant_configs` ADD `ai_model` text;