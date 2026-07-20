CREATE TABLE `contact_role_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`kind` text NOT NULL,
	`email_template_id` text,
	`sms_template_id` text,
	`is_system` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_crp_tenant` ON `contact_role_profiles` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_crp_tenant_key` ON `contact_role_profiles` (`tenant_id`,`key`) WHERE is_active = 1;--> statement-breakpoint
CREATE TABLE `inspection_people` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`inspection_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`role_profile_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_ip_inspection` ON `inspection_people` (`inspection_id`);--> statement-breakpoint
CREATE INDEX `idx_ip_tenant` ON `inspection_people` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_ip_insp_contact_role` ON `inspection_people` (`inspection_id`,`contact_id`,`role_profile_id`);