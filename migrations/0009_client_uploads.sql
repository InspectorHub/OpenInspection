CREATE TABLE `client_uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`inspection_id` text NOT NULL,
	`uploaded_by_kind` text NOT NULL,
	`uploaded_by_ref` text NOT NULL,
	`uploaded_by_name` text,
	`category` text NOT NULL,
	`visibility` text NOT NULL,
	`r2_key` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`label` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_client_uploads_inspection` ON `client_uploads` (`tenant_id`,`inspection_id`);