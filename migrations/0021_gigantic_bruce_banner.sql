CREATE TABLE `tenant_legal_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`doc` text NOT NULL,
	`version` text NOT NULL,
	`body_snapshot` text,
	`content_hash` text NOT NULL,
	`is_material` integer DEFAULT false NOT NULL,
	`published_at` integer NOT NULL,
	`published_by_user_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tenant_legal_versions_doc_version` ON `tenant_legal_versions` (`tenant_id`,`doc`,`version`);--> statement-breakpoint
CREATE INDEX `idx_tenant_legal_versions_latest` ON `tenant_legal_versions` (`tenant_id`,`doc`,`published_at`);