ALTER TABLE `inspection_media_pool` ADD `media_type` text DEFAULT 'photo' NOT NULL;--> statement-breakpoint
ALTER TABLE `inspection_media_pool` ADD `stream_uid` text;--> statement-breakpoint
ALTER TABLE `inspection_media_pool` ADD `poster_pct` real;--> statement-breakpoint
ALTER TABLE `inspection_media_pool` ADD `duration_sec` integer;