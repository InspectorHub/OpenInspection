CREATE TABLE `message_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`channel` text NOT NULL,
	`subject` text,
	`body` text NOT NULL,
	`variables` text,
	`is_seeded` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_message_templates_tenant_channel` ON `message_templates` (`tenant_id`,`channel`);--> statement-breakpoint
ALTER TABLE `automations` ADD `email_template_id` text;--> statement-breakpoint
ALTER TABLE `automations` ADD `sms_template_id` text;