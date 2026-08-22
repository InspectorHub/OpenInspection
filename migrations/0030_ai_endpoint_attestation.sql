ALTER TABLE `ai_call_provenance` ADD `config_version` integer;--> statement-breakpoint
ALTER TABLE `tenant_configs` ADD `ai_config_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tenant_configs` ADD `ai_key_attestation_endpoint` text;--> statement-breakpoint
ALTER TABLE `tenant_configs` ADD `ai_key_attestation_model` text;--> statement-breakpoint
ALTER TABLE `tenant_configs` ADD `ai_key_attestation_service_tier` text;--> statement-breakpoint
ALTER TABLE `tenant_configs` ADD `ai_key_attestation_intended_use` text;--> statement-breakpoint
ALTER TABLE `tenant_configs` ADD `ai_key_attestation_config_version` integer;