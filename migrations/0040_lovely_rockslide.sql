CREATE TABLE `inspection_service_pay_splits` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`inspection_service_id` text NOT NULL,
	`user_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`source` text NOT NULL,
	`locked_at` integer,
	`corrects_split_id` text,
	`reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_pay_split_line_user` ON `inspection_service_pay_splits` (`tenant_id`,`inspection_service_id`,`user_id`) WHERE corrects_split_id IS NULL;--> statement-breakpoint
CREATE INDEX `idx_pay_split_user` ON `inspection_service_pay_splits` (`tenant_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_pay_split_line` ON `inspection_service_pay_splits` (`tenant_id`,`inspection_service_id`);--> statement-breakpoint
CREATE TABLE `service_pay_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`service_id` text NOT NULL,
	`user_id` text,
	`type` text NOT NULL,
	`value` integer NOT NULL,
	`deduction_cents` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_service_pay_rules_user` ON `service_pay_rules` (`tenant_id`,`service_id`,`user_id`) WHERE user_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_service_pay_rules_default` ON `service_pay_rules` (`tenant_id`,`service_id`) WHERE user_id IS NULL;