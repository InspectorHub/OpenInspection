CREATE TABLE `processed_webhook_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`received_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sms_delivery_status` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`provider_message_id` text NOT NULL,
	`status` text NOT NULL,
	`error_code` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sms_delivery_status_msg` ON `sms_delivery_status` (`tenant_id`,`provider_message_id`);