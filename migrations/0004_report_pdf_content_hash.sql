ALTER TABLE `report_pdfs` ADD `content_hash` text;--> statement-breakpoint
CREATE INDEX `idx_report_pdfs_content_hash` ON `report_pdfs` (`inspection_id`,`type`,`content_hash`);