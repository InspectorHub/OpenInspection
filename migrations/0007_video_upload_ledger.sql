CREATE TABLE `video_upload_parts` (
	`tenant_id` text NOT NULL,
	`media_id` text NOT NULL,
	`part_number` integer NOT NULL,
	`etag` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`received_at` integer NOT NULL,
	PRIMARY KEY(`tenant_id`, `media_id`, `part_number`)
);
--> statement-breakpoint
CREATE TABLE `video_uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`inspection_id` text NOT NULL,
	`media_id` text NOT NULL,
	`user_id` text NOT NULL,
	`upload_id` text,
	`r2_key` text,
	`content_type` text,
	`total_bytes` integer NOT NULL,
	`part_bytes` integer NOT NULL,
	`part_count` integer NOT NULL,
	`state` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`completed_at` integer,
	`completing_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_video_uploads_media` ON `video_uploads` (`tenant_id`,`media_id`);--> statement-breakpoint
CREATE INDEX `idx_video_uploads_sweep` ON `video_uploads` (`state`,`expires_at`);