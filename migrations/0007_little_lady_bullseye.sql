DROP TABLE `agent_tenant_links`;--> statement-breakpoint
ALTER TABLE `contacts` ADD `agent_user_id` text;--> statement-breakpoint
ALTER TABLE `contacts` ADD `agent_linked_at` integer;--> statement-breakpoint
ALTER TABLE `contacts` ADD `agent_revoked_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_contacts_tenant_agent_user` ON `contacts` (`tenant_id`,`agent_user_id`) WHERE agent_user_id IS NOT NULL AND archived_at IS NULL;--> statement-breakpoint
CREATE INDEX `idx_contacts_agent_user` ON `contacts` (`agent_user_id`);