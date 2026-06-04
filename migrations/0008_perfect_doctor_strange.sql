-- A-17: physical tenant isolation for inspection_conflicts.
-- Hand-edited from the generated bare `ADD COLUMN ... NOT NULL` (which SQLite
-- rejects on a non-empty table, and a DEFAULT would weaken the schema's
-- insert-time tenant_id requirement). Table-recreate is safe here: the table
-- has no foreign keys in either direction. The INSERT..JOIN backfills each
-- conflict's tenant from its owning inspection; conflicts whose inspection is
-- gone are dropped (they are transient adjudication flags).
CREATE TABLE `__new_inspection_conflicts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`inspection_id` text NOT NULL,
	`item_id` text NOT NULL,
	`section_id` text,
	`field` text NOT NULL,
	`base` text,
	`local` text,
	`remote` text,
	`created_at` text NOT NULL,
	`resolved_at` text
);
--> statement-breakpoint
INSERT INTO `__new_inspection_conflicts` (`id`, `tenant_id`, `inspection_id`, `item_id`, `section_id`, `field`, `base`, `local`, `remote`, `created_at`, `resolved_at`)
SELECT c.`id`, i.`tenant_id`, c.`inspection_id`, c.`item_id`, c.`section_id`, c.`field`, c.`base`, c.`local`, c.`remote`, c.`created_at`, c.`resolved_at`
FROM `inspection_conflicts` c JOIN `inspections` i ON i.`id` = c.`inspection_id`;--> statement-breakpoint
DROP TABLE `inspection_conflicts`;--> statement-breakpoint
ALTER TABLE `__new_inspection_conflicts` RENAME TO `inspection_conflicts`;--> statement-breakpoint
CREATE INDEX `idx_inspection_conflicts_inspection` ON `inspection_conflicts` (`inspection_id`,`resolved_at`);
