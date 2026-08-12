-- Retires the three automations copy columns. Their content now lives in
-- message_templates: ensureSeeds writes the template and puts its id on the
-- rule, and every pre-existing tenant was drained before this shipped.
--
-- Hand-written, never generated. A native column removal drops the column in
-- place; drizzle's generated alternative is a twelve-step table rebuild that
-- copies the whole table under a new name, retires the original, and renames
-- the copy into place. That rebuild is unsafe on D1 outside a transaction: D1
-- cannot turn off foreign-key enforcement except inside one, and the rebuild's
-- retirement of the original table would otherwise drop rows other tables
-- still reference mid-migration.
--
-- SQLite refuses a native column removal only when the column is part of the
-- table's primary key, carries a UNIQUE or CHECK constraint, is named in a
-- foreign key, backs a generated-column expression or a partial index's
-- predicate, or is read by a view. None of that applies to these three —
-- plain, unconstrained, unindexed text columns — so the native path is safe
-- here.
ALTER TABLE `automations` DROP COLUMN `subject_template`;--> statement-breakpoint
ALTER TABLE `automations` DROP COLUMN `body_template`;--> statement-breakpoint
ALTER TABLE `automations` DROP COLUMN `sms_body`;
