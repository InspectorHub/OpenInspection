DROP INDEX `idx_avail_overrides_block_unique`;--> statement-breakpoint
ALTER TABLE `availability_overrides` ADD `source` text;--> statement-breakpoint
ALTER TABLE `availability_overrides` ADD `external_id` text;--> statement-breakpoint
ALTER TABLE `availability_overrides` ADD `transparency` text;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_avail_overrides_external` ON `availability_overrides` (`inspector_id`,`source`,`external_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_avail_overrides_block_unique` ON `availability_overrides` (`inspector_id`,`date`) WHERE is_available = 0 AND source IS NULL;