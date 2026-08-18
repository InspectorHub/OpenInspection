CREATE TABLE `account_acceptances` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`actor_identity_ref` text,
	`doc` text NOT NULL,
	`version` text NOT NULL,
	`content_hash` text NOT NULL,
	`authority_basis` text NOT NULL,
	`accepted_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_account_acceptances_user_doc_version` ON `account_acceptances` (`user_id`,`doc`,`version`);--> statement-breakpoint
CREATE INDEX `idx_account_acceptances_tenant` ON `account_acceptances` (`tenant_id`,`accepted_at`);