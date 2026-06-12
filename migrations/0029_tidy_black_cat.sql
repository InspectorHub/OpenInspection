CREATE TABLE `usage_counters` (
	`tenant_id` text NOT NULL,
	`metric` text NOT NULL,
	`period_key` text NOT NULL,
	`value` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`tenant_id`, `metric`, `period_key`)
);
--> statement-breakpoint
CREATE INDEX `idx_usage_counters_tenant` ON `usage_counters` (`tenant_id`);