CREATE TABLE `tenant_custom_holidays` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`date` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_tenant_custom_holidays_tenant_date` ON `tenant_custom_holidays` (`tenant_id`,`date`);--> statement-breakpoint
CREATE INDEX `idx_tenant_custom_holidays_tenant_date` ON `tenant_custom_holidays` (`tenant_id`,`date`);--> statement-breakpoint
ALTER TABLE `tenant_configs` ADD `holiday_region` text;--> statement-breakpoint
ALTER TABLE `tenant_configs` ADD `holiday_public_policy` text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE `tenant_configs` ADD `holiday_internal_policy` text DEFAULT 'advisory' NOT NULL;