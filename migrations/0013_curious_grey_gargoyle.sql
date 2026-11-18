CREATE TABLE `import_id_map` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`package_id` text NOT NULL,
	`table_name` text NOT NULL,
	`source_id` text NOT NULL,
	`new_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_import_id_map_source` ON `import_id_map` (`tenant_id`,`package_id`,`table_name`,`source_id`);--> statement-breakpoint
CREATE INDEX `idx_import_id_map_new_id` ON `import_id_map` (`tenant_id`,`table_name`,`new_id`);--> statement-breakpoint
CREATE INDEX `idx_import_id_map_package` ON `import_id_map` (`tenant_id`,`package_id`);