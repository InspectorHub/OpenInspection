CREATE TABLE `migration_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`created_by` text NOT NULL,
	`intent` text NOT NULL,
	`target_id` text,
	`vendor` text NOT NULL,
	`adapter_name` text NOT NULL,
	`adapter_version` text NOT NULL,
	`manifest` text NOT NULL,
	`conflict_policy` text,
	`status` text DEFAULT 'staged' NOT NULL,
	`created_at` integer NOT NULL,
	`applied_at` integer,
	`reverted_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_migration_batches_tenant_created` ON `migration_batches` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `migration_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`entity` text NOT NULL,
	`position` integer NOT NULL,
	`payload` text NOT NULL,
	`conflict_with` text,
	`resolution` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`outcome` text,
	`created_id` text,
	`prior_state` text,
	`applied_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_migration_rows_batch_status` ON `migration_rows` (`batch_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_migration_rows_tenant` ON `migration_rows` (`tenant_id`);