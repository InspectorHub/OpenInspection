CREATE TABLE `import_archives` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`package_id` text NOT NULL,
	`sha256` text NOT NULL,
	`counts` text,
	`source_ids` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_import_archives_package` ON `import_archives` (`tenant_id`,`package_id`);--> statement-breakpoint
CREATE INDEX `idx_import_archives_tenant_id` ON `import_archives` (`tenant_id`,`id`);