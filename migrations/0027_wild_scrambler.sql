ALTER TABLE `migration_batches` ADD `source_key` text;--> statement-breakpoint
ALTER TABLE `migration_batches` ADD `expires_at` integer;--> statement-breakpoint
ALTER TABLE `migration_batches` ADD `upload_authorized_by` text;--> statement-breakpoint
ALTER TABLE `migration_batches` ADD `upload_authorized_at` integer;--> statement-breakpoint
ALTER TABLE `migration_batches` ADD `upload_authorization_version` text;--> statement-breakpoint
ALTER TABLE `migration_batches` ADD `staff_access_authorized_by` text;--> statement-breakpoint
ALTER TABLE `migration_batches` ADD `staff_access_authorized_at` integer;--> statement-breakpoint
ALTER TABLE `migration_batches` ADD `staff_access_authorization_version` text;--> statement-breakpoint
CREATE INDEX `idx_migration_batches_expires` ON `migration_batches` (`expires_at`);