-- Move the three agent notification booleans on `users` into
-- `notification_preferences`, then retire the columns.
--
-- Only rows that DIFFER from the class default are written. That keeps the
-- table growing with decisions rather than with the user base (design §3.2),
-- and it is why the third statement looks inverted: `is_paid_notification_enabled`
-- defaulted to FALSE, and the class it becomes carries `defaultEnabled: false`
-- to preserve exactly that. So the row to store there is the one where a user
-- had explicitly turned it ON.
--
-- Without a per-class default this migration had only bad answers: write a mute
-- row for every user, or silently start sending invoice-paid mail to agents who
-- never asked for it.

INSERT INTO notification_preferences (id, tenant_id, subject_kind, subject_id, class_id, channel, enabled, created_at, updated_at)
SELECT lower(hex(randomblob(16))), tenant_id, 'user', id, 'agent-new-referral', 'email', 0,
       CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000
FROM users WHERE is_referral_notification_enabled = 0;
--> statement-breakpoint
INSERT INTO notification_preferences (id, tenant_id, subject_kind, subject_id, class_id, channel, enabled, created_at, updated_at)
SELECT lower(hex(randomblob(16))), tenant_id, 'user', id, 'agent-report-ready', 'email', 0,
       CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000
FROM users WHERE is_report_notification_enabled = 0;
--> statement-breakpoint
INSERT INTO notification_preferences (id, tenant_id, subject_kind, subject_id, class_id, channel, enabled, created_at, updated_at)
SELECT lower(hex(randomblob(16))), tenant_id, 'user', id, 'agent-invoice-paid', 'email', 1,
       CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000
FROM users WHERE is_paid_notification_enabled = 1;
--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `is_referral_notification_enabled`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `is_report_notification_enabled`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `is_paid_notification_enabled`;