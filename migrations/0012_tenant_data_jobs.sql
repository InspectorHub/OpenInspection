CREATE TABLE `tenant_data_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`stage` text NOT NULL,
	`cursor` text,
	`package_id` text,
	`bytes` integer DEFAULT 0 NOT NULL,
	`sha256` text,
	`counts` text,
	`error_code` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`updated_at` integer NOT NULL,
	`finished_at` integer,
	`lease_holder` text,
	`lease_expires_at` integer,
	`client_kind` text,
	CONSTRAINT "ck_tenant_data_jobs_cursor_len" CHECK("tenant_data_jobs"."cursor" IS NULL OR length("tenant_data_jobs"."cursor") <= 4096),
	CONSTRAINT "ck_tenant_data_jobs_counts_len" CHECK("tenant_data_jobs"."counts" IS NULL OR length("tenant_data_jobs"."counts") <= 4096)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_tenant_data_jobs_active` ON `tenant_data_jobs` (`tenant_id`) WHERE status IN ('queued', 'running');--> statement-breakpoint
CREATE INDEX `idx_tenant_data_jobs_tenant_id` ON `tenant_data_jobs` (`tenant_id`,`id`);--> statement-breakpoint
CREATE INDEX `idx_tenant_data_jobs_tenant_created` ON `tenant_data_jobs` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_tenant_data_jobs_sweep` ON `tenant_data_jobs` (`status`,`lease_expires_at`);