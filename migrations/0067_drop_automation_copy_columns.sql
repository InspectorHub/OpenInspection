-- Retires the three automations copy columns. Their content now lives in
-- message_templates: ensureSeeds writes the template and puts its id on the
-- rule, and every pre-existing tenant was drained before this shipped.
--
-- Hand-written, never generated. Native DROP COLUMN removes a column in place;
-- drizzle's generated alternative is a twelve-step table rebuild that copies
-- the whole table under a new name, retires the original, and renames the copy
-- into place — unsafe on D1 outside a transaction. None of these three columns
-- carries an index, which is the only thing SQLite refuses a native drop for.
ALTER TABLE `automations` DROP COLUMN `subject_template`;--> statement-breakpoint
ALTER TABLE `automations` DROP COLUMN `body_template`;--> statement-breakpoint
ALTER TABLE `automations` DROP COLUMN `sms_body`;
