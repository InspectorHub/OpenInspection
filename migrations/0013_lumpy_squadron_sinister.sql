PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agreement_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`inspection_id` text NOT NULL,
	`agreement_id` text NOT NULL,
	`client_email` text NOT NULL,
	`client_name` text,
	`token` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`signature_base64` text,
	`signed_at` integer,
	`viewed_at` integer,
	`sent_at` integer,
	`last_error` text,
	`inspector_signature_base64` text,
	`inspector_signed_at` integer,
	`inspector_user_id` text,
	`verification_token` text,
	`content_snapshot` text,
	`content_hash` text,
	`completion_policy` text DEFAULT 'all' NOT NULL,
	`token_hash` text,
	`purged_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`inspection_id`) REFERENCES `inspections`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agreement_id`) REFERENCES `agreements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`inspector_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_agreement_requests`("id", "tenant_id", "inspection_id", "agreement_id", "client_email", "client_name", "token", "status", "signature_base64", "signed_at", "viewed_at", "sent_at", "last_error", "inspector_signature_base64", "inspector_signed_at", "inspector_user_id", "verification_token", "content_snapshot", "content_hash", "completion_policy", "token_hash", "purged_at", "created_at") SELECT "id", "tenant_id", "inspection_id", "agreement_id", "client_email", "client_name", "token", "status", "signature_base64", "signed_at", "viewed_at", "sent_at", "last_error", "inspector_signature_base64", "inspector_signed_at", "inspector_user_id", "verification_token", "content_snapshot", "content_hash", "completion_policy", "token_hash", "purged_at", "created_at" FROM `agreement_requests`;--> statement-breakpoint
DROP TABLE `agreement_requests`;--> statement-breakpoint
ALTER TABLE `__new_agreement_requests` RENAME TO `agreement_requests`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `agreement_requests_token_unique` ON `agreement_requests` (`token`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_agreement_requests_verify_token` ON `agreement_requests` (`verification_token`);--> statement-breakpoint
CREATE INDEX `idx_agreement_requests_tenant` ON `agreement_requests` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_agreement_requests_inspection` ON `agreement_requests` (`inspection_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_agreement_requests_token_hash` ON `agreement_requests` (`token_hash`);