CREATE TABLE `order_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`inspection_id` text,
	`invoice_id` text,
	`kind` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`method` text NOT NULL,
	`provider` text,
	`provider_ref` text,
	`recorded_by` text,
	`refunds_id` text,
	`note` text,
	`occurred_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_order_payments_inspection` ON `order_payments` (`tenant_id`,`inspection_id`);--> statement-breakpoint
CREATE INDEX `idx_order_payments_invoice` ON `order_payments` (`tenant_id`,`invoice_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_order_payments_provider_ref` ON `order_payments` (`tenant_id`,`provider`,`provider_ref`);