CREATE TABLE `ai_call_provenance` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`capability` text NOT NULL,
	`provider` text NOT NULL,
	`mode` text NOT NULL,
	`model` text NOT NULL,
	`prompt_version` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_ai_call_provenance_tenant_created` ON `ai_call_provenance` (`tenant_id`,`created_at`);