DROP INDEX `uq_report_pdfs_inspection_type`;--> statement-breakpoint
ALTER TABLE `report_pdfs` ADD `version_number` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_report_pdfs_inspection_type` ON `report_pdfs` (`inspection_id`,`type`,`version_number`);--> statement-breakpoint
ALTER TABLE `report_versions` ADD `content_hash` text;--> statement-breakpoint
ALTER TABLE `report_versions` ADD `prev_hash` text;--> statement-breakpoint
ALTER TABLE `report_versions` ADD `signature` text;--> statement-breakpoint
ALTER TABLE `report_versions` ADD `key_fingerprint` text;--> statement-breakpoint
ALTER TABLE `report_versions` ADD `is_amendment` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `report_versions` ADD `verification_token` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_report_versions_verify_token` ON `report_versions` (`verification_token`);