CREATE TABLE `ai_content_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`artifact_type` text NOT NULL,
	`artifact_id` text NOT NULL,
	`reviewed_by` text NOT NULL,
	`reviewed_at` integer NOT NULL,
	`ai_call_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_ai_content_reviews_tenant_artifact` ON `ai_content_reviews` (`tenant_id`,`artifact_type`,`artifact_id`);--> statement-breakpoint
CREATE INDEX `idx_ai_content_reviews_ai_call` ON `ai_content_reviews` (`ai_call_id`);