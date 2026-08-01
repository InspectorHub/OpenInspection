-- HAND-EDITED. drizzle-kit generated an INSERT that selected `subject_kind` and
-- `subject_id` FROM the old table, where neither column exists yet — "no such
-- column", with DROP TABLE as the very next statement. On a table holding SMS
-- consent evidence that is not an acceptable failure mode, so the copy below
-- supplies the new columns as literals and backfills the subject from the
-- contact every existing row already has.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_sms_consent_log` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`contact_id` text,
	`recipient_type` text NOT NULL,
	`action` text NOT NULL,
	`disclosure_version` integer NOT NULL,
	`captured_via` text NOT NULL,
	`ip` text,
	`user_agent` text,
	`created_at` integer NOT NULL,
	`subject_kind` text DEFAULT 'contact' NOT NULL,
	`subject_id` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_sms_consent_log`("id", "tenant_id", "contact_id", "recipient_type", "action", "disclosure_version", "captured_via", "ip", "user_agent", "created_at", "subject_kind", "subject_id") SELECT "id", "tenant_id", "contact_id", "recipient_type", "action", "disclosure_version", "captured_via", "ip", "user_agent", "created_at", 'contact', "contact_id" FROM `sms_consent_log`;--> statement-breakpoint
DROP TABLE `sms_consent_log`;--> statement-breakpoint
ALTER TABLE `__new_sms_consent_log` RENAME TO `sms_consent_log`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_sms_consent_contact` ON `sms_consent_log` (`tenant_id`,`contact_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_sms_consent_subject` ON `sms_consent_log` (`tenant_id`,`subject_kind`,`subject_id`,`created_at`);
