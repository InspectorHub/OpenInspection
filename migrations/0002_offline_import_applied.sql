CREATE TABLE `offline_import_applied` (
	`tenant_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`op` text NOT NULL,
	`inspection_id` text NOT NULL,
	`applied_at` integer NOT NULL,
	`applied_by` text NOT NULL,
	PRIMARY KEY(`tenant_id`, `idempotency_key`)
);
