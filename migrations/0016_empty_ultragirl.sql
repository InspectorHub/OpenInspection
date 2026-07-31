ALTER TABLE `automation_logs` ADD `notice_id` text;--> statement-breakpoint
ALTER TABLE `notifications` ADD `contact_id` text;--> statement-breakpoint
ALTER TABLE `notifications` ADD `inspection_id` text;--> statement-breakpoint
CREATE INDEX `idx_notifications_tenant_contact_created` ON `notifications` (`tenant_id`,`contact_id`,`created_at`);