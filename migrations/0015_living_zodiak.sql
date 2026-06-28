CREATE TABLE `integration_test_results` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`target` text NOT NULL,
	`provider` text,
	`ok` integer NOT NULL,
	`detail` text,
	`tested_by_user_id` text,
	`tested_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_integration_test_tenant_target` ON `integration_test_results` (`tenant_id`,`target`,`tested_at`);