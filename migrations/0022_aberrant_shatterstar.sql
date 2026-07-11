CREATE TABLE `document_review_items` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`inspection_id` text NOT NULL,
	`document_key` text NOT NULL,
	`label` text NOT NULL,
	`requested` integer DEFAULT false NOT NULL,
	`received` integer DEFAULT false NOT NULL,
	`reviewed` integer DEFAULT false NOT NULL,
	`na` integer DEFAULT false NOT NULL,
	`notes` text,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_doc_review_inspection` ON `document_review_items` (`tenant_id`,`inspection_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_doc_review_item` ON `document_review_items` (`inspection_id`,`document_key`);--> statement-breakpoint
CREATE TABLE `psq_responses` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`inspection_id` text NOT NULL,
	`responses` text,
	`status` text DEFAULT 'sent' NOT NULL,
	`share_token` text,
	`sent_at` integer,
	`received_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_psq_inspection` ON `psq_responses` (`tenant_id`,`inspection_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_psq_share_token` ON `psq_responses` (`share_token`);--> statement-breakpoint
CREATE TABLE `report_signoff` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`inspection_id` text NOT NULL,
	`role` text NOT NULL,
	`person_id` text NOT NULL,
	`name` text NOT NULL,
	`license` text,
	`qualifications_ref` text,
	`signed_at` integer NOT NULL,
	`signature_ref` text NOT NULL,
	`dual_role` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_report_signoff_inspection` ON `report_signoff` (`tenant_id`,`inspection_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_report_signoff_role` ON `report_signoff` (`inspection_id`,`role`);