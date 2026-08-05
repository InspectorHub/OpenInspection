CREATE TABLE `idempotency_keys` (
	`tenant_id` text NOT NULL,
	`key` text NOT NULL,
	`fingerprint` text NOT NULL,
	`state` text DEFAULT 'in_flight' NOT NULL,
	`response_status` integer,
	`response_body` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	PRIMARY KEY(`tenant_id`, `key`)
);
--> statement-breakpoint
CREATE INDEX `idx_idempotency_expires` ON `idempotency_keys` (`expires_at`);