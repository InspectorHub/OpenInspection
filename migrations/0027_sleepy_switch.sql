CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`inspection_id` text NOT NULL,
	`kind` text NOT NULL,
	`inspection_service_id` text,
	`template_id` text,
	`title` text NOT NULL,
	`status` text DEFAULT 'in_progress' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_reports_inspection` ON `reports` (`inspection_id`);--> statement-breakpoint
CREATE INDEX `idx_reports_tenant` ON `reports` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_reports_primary` ON `reports` (`inspection_id`) WHERE kind = 'primary';