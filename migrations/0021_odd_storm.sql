CREATE TABLE `deployment_legal_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`doc` text NOT NULL,
	`version` text NOT NULL,
	`body_snapshot` text NOT NULL,
	`content_hash` text NOT NULL,
	`published_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_deployment_legal_versions_doc_hash` ON `deployment_legal_versions` (`doc`,`content_hash`);--> statement-breakpoint
CREATE INDEX `idx_deployment_legal_versions_latest` ON `deployment_legal_versions` (`doc`,`published_at`);