ALTER TABLE `inspection_media_pool` ADD `provider` text DEFAULT 'stream' NOT NULL;--> statement-breakpoint
ALTER TABLE `inspection_media_pool` ADD `poster_key` text;--> statement-breakpoint
ALTER TABLE `tenant_configs` ADD `video_mode` text DEFAULT 'r2' NOT NULL;