CREATE TABLE `native_client_seen` (
	`tenant_id` text NOT NULL,
	`platform` text NOT NULL,
	`client_version` text NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	PRIMARY KEY(`tenant_id`, `platform`, `client_version`)
);
--> statement-breakpoint
CREATE TABLE `offline_import_applied` (
	`tenant_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`op` text NOT NULL,
	`inspection_id` text NOT NULL,
	`applied_at` integer NOT NULL,
	`applied_by` text NOT NULL,
	PRIMARY KEY(`tenant_id`, `idempotency_key`, `inspection_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_offline_import_applied_age` ON `offline_import_applied` (`tenant_id`,`applied_at`);