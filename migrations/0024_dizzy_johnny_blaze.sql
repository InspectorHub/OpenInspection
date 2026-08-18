CREATE TABLE `legal_holds` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`matter` text NOT NULL,
	`reason` text NOT NULL,
	`placed_by` text NOT NULL,
	`placed_at` integer NOT NULL,
	`released_at` integer,
	`released_by` text,
	`release_reason` text
);
--> statement-breakpoint
CREATE INDEX `idx_legal_holds_tenant_active` ON `legal_holds` (`tenant_id`,`released_at`);