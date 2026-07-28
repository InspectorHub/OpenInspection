PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agent_tenant_links` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_user_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`inspector_contact_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`invited_by_user_id` text,
	`created_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`agent_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_agent_tenant_links`("id", "agent_user_id", "tenant_id", "inspector_contact_id", "status", "invited_by_user_id", "created_at", "revoked_at") SELECT "id", "agent_user_id", "tenant_id", "inspector_contact_id", "status", "invited_by_user_id", "created_at", "revoked_at" FROM `agent_tenant_links`;--> statement-breakpoint
DROP TABLE `agent_tenant_links`;--> statement-breakpoint
ALTER TABLE `__new_agent_tenant_links` RENAME TO `agent_tenant_links`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_agent_tenant_unique` ON `agent_tenant_links` (`agent_user_id`,`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_tenant_by_tenant` ON `agent_tenant_links` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_agent_tenant_by_agent` ON `agent_tenant_links` (`agent_user_id`,`status`);