ALTER TABLE `tenant_configs` ADD `ai_key_attestation_provider` text;--> statement-breakpoint
ALTER TABLE `tenant_configs` ADD `ai_key_attestation_mode` text;--> statement-breakpoint
ALTER TABLE `tenant_configs` ADD `ai_key_attestation_account_owner` text;--> statement-breakpoint
ALTER TABLE `tenant_configs` ADD `ai_key_attestation_terms_version` text;--> statement-breakpoint
ALTER TABLE `tenant_configs` ADD `ai_key_attestation_attested_at` integer;--> statement-breakpoint
ALTER TABLE `tenant_configs` ADD `ai_key_attestation_policy_version` text;