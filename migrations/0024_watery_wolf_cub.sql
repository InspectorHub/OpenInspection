CREATE TABLE `report_exports` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`inspection_id` text NOT NULL,
	`format` text NOT NULL,
	`status` text NOT NULL,
	`r2_key` text,
	`size_bytes` integer,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_report_exports_inspection` ON `report_exports` (`tenant_id`,`inspection_id`);