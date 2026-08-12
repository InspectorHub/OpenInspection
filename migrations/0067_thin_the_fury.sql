PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_automations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`trigger` text NOT NULL,
	`recipient_kind` text NOT NULL,
	`recipient_role_profile_id` text,
	`delay_minutes` integer DEFAULT 0 NOT NULL,
	`subject_template` text,
	`body_template` text,
	`email_template_id` text,
	`conditions` text,
	`channels` text DEFAULT '["email"]' NOT NULL,
	`sms_body` text,
	`sms_template_id` text,
	`is_active` integer DEFAULT true NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`in_app_template_id` text,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_automations`("id", "tenant_id", "name", "trigger", "recipient_kind", "recipient_role_profile_id", "delay_minutes", "subject_template", "body_template", "email_template_id", "conditions", "channels", "sms_body", "sms_template_id", "is_active", "is_default", "created_at", "in_app_template_id") SELECT "id", "tenant_id", "name", "trigger", "recipient_kind", "recipient_role_profile_id", "delay_minutes", "subject_template", "body_template", "email_template_id", "conditions", "channels", "sms_body", "sms_template_id", "is_active", "is_default", "created_at", "in_app_template_id" FROM `automations`;--> statement-breakpoint
DROP TABLE `automations`;--> statement-breakpoint
ALTER TABLE `__new_automations` RENAME TO `automations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_automations_tenant` ON `automations` (`tenant_id`);