CREATE TABLE `permission_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`base_role` text NOT NULL,
	`overrides` text NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_permission_templates_name` ON `permission_templates` (`tenant_id`,`name`) WHERE archived_at IS NULL;