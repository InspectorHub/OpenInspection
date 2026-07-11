ALTER TABLE `tenant_configs` ADD `reserve_schedule_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `tenant_configs` ADD `reserve_term_years` integer DEFAULT 12 NOT NULL;--> statement-breakpoint
ALTER TABLE `tenant_configs` ADD `inflation_rate_bps` integer;