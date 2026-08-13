ALTER TABLE `tenant_destruction_records` ADD `status` text DEFAULT 'completed' NOT NULL;--> statement-breakpoint
ALTER TABLE `tenant_destruction_records` ADD `completed_at` integer;