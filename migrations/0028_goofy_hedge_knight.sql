ALTER TABLE `inspections` ADD `source_inspection_id` text;--> statement-breakpoint
ALTER TABLE `inspections` ADD `root_inspection_id` text;--> statement-breakpoint
ALTER TABLE `inspections` ADD `reinspection_round` integer;--> statement-breakpoint
CREATE INDEX `idx_inspections_root` ON `inspections` (`root_inspection_id`);--> statement-breakpoint
ALTER TABLE `tenant_configs` ADD `reinspection_statuses` text;