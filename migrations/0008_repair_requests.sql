CREATE TABLE `repair_request_items` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`repair_request_id` text NOT NULL,
	`finding_key` text NOT NULL,
	`section_title` text NOT NULL,
	`item_label` text NOT NULL,
	`comment_snapshot` text,
	`requested_credit_cents` integer,
	`note` text,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_repair_request_items_rr` ON `repair_request_items` (`repair_request_id`);--> statement-breakpoint
CREATE TABLE `repair_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`inspection_id` text NOT NULL,
	`created_by_kind` text NOT NULL,
	`created_by_ref` text NOT NULL,
	`custom_intro` text,
	`share_token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_repair_requests_inspection` ON `repair_requests` (`tenant_id`,`inspection_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_repair_requests_share_token` ON `repair_requests` (`share_token`);