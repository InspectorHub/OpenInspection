CREATE TABLE `tenant_slug_history` (
	`old_slug` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`changed_at` integer NOT NULL,
	`retired_until` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_tenant_slug_history_tenant` ON `tenant_slug_history` (`tenant_id`);--> statement-breakpoint
ALTER TABLE `agreement_requests` ADD `signer_legal_name` text;--> statement-breakpoint
ALTER TABLE `agreement_requests` ADD `signer_company_name` text;--> statement-breakpoint
ALTER TABLE `tenant_configs` ADD `legal_name` text;