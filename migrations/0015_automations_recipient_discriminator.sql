PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_automations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`trigger` text NOT NULL,
	`recipient_kind` text NOT NULL,
	`recipient_role_profile_id` text,
	`delay_minutes` integer DEFAULT 0 NOT NULL,
	`subject_template` text NOT NULL,
	`body_template` text NOT NULL,
	`email_template_id` text,
	`conditions` text,
	`channels` text DEFAULT '["email"]' NOT NULL,
	`sms_body` text,
	`sms_template_id` text,
	`is_active` integer DEFAULT true NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_automations`("id", "tenant_id", "name", "trigger", "recipient_kind", "recipient_role_profile_id", "delay_minutes", "subject_template", "body_template", "email_template_id", "conditions", "channels", "sms_body", "sms_template_id", "is_active", "is_default", "created_at")
SELECT
	"id", "tenant_id", "name", "trigger",
	CASE recipient WHEN 'inspector' THEN 'inspector' WHEN 'all' THEN 'all' ELSE 'role' END,
	CASE recipient
		WHEN 'client'        THEN (SELECT id FROM contact_role_profiles crp WHERE crp.tenant_id = automations.tenant_id AND crp.key = 'client'        AND crp.is_active = 1 LIMIT 1)
		WHEN 'buying_agent'  THEN (SELECT id FROM contact_role_profiles crp WHERE crp.tenant_id = automations.tenant_id AND crp.key = 'buyer_agent'   AND crp.is_active = 1 LIMIT 1)
		WHEN 'selling_agent' THEN (SELECT id FROM contact_role_profiles crp WHERE crp.tenant_id = automations.tenant_id AND crp.key = 'listing_agent' AND crp.is_active = 1 LIMIT 1)
		ELSE NULL
	END,
	"delay_minutes", "subject_template", "body_template", "email_template_id", "conditions", "channels", "sms_body", "sms_template_id", "is_active", "is_default", "created_at"
FROM `automations`;
--> statement-breakpoint
DROP TABLE `automations`;--> statement-breakpoint
ALTER TABLE `__new_automations` RENAME TO `automations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_automations_tenant` ON `automations` (`tenant_id`);
