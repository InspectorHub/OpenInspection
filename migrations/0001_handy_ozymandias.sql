CREATE TABLE `inspection_access_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`inspection_id` text NOT NULL,
	`recipient_email` text NOT NULL,
	`role` text DEFAULT 'client' NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_iat_token` ON `inspection_access_tokens` (`token`);--> statement-breakpoint
CREATE INDEX `idx_iat_inspection` ON `inspection_access_tokens` (`tenant_id`,`inspection_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_iat_recipient` ON `inspection_access_tokens` (`inspection_id`,`recipient_email`);