ALTER TABLE `inspections` ADD `deposit_required_cents` integer;--> statement-breakpoint
ALTER TABLE `inspections` ADD `is_deposit_overridden` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `services` ADD `deposit_policy` text;--> statement-breakpoint
ALTER TABLE `tenant_configs` ADD `deposit_policy` text;