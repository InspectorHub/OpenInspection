CREATE TABLE `inspector_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`label` text NOT NULL,
	`member_number` text,
	`image_r2_key` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_inspector_credentials_tenant` ON `inspector_credentials` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_inspector_credentials_user` ON `inspector_credentials` (`user_id`);