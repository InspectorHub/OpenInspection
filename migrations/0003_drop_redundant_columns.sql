-- Retire ten columns that nothing reads, and rebuild the one table whose
-- primary key was a placeholder for a secret it never held.
--
-- Every column below was established dead by scanning both its snake_case DB
-- name and its camelCase drizzle property across server/, app/, packages/ and
-- scripts/, excluding the schema definitions themselves. Two of them had been
-- carrying a `DEAD` comment since 2026-06-13 and were still there; one
-- (`messaging_compliance.subaccount_sid`) carried no marker at all and turned
-- out to be the single column of an actively-used table with code on neither
-- side of it.
--
-- Hand-written, per the Schema Rules: `db:generate` emits a twelve-step table
-- rebuild for a DROP COLUMN, which needs `PRAGMA foreign_keys=OFF` outside a
-- transaction and so cannot run on D1. Each statement below is a native
-- `ALTER TABLE ... DROP COLUMN`, verified against a SQLite built from
-- `0000_baseline.sql` before it was written down.
--
-- ⚠️ THE REBUILD-SIGNATURE GREP WILL MATCH THIS FILE, ON PURPOSE. The Schema
-- Rules say `grep -nE "PRAGMA|__new_|DROP TABLE|RENAME TO"` must come back
-- empty, because those four strings are what a generated rebuild looks like.
-- The `DROP TABLE` at the bottom is not that: it is a deliberate re-creation of
-- a table that was EMPTY, confirmed by counting rows on the production database
-- immediately before this migration was written (0 rows) and again before it is
-- applied. The other three strings do not appear. A reviewer seeing the match
-- should check that count, not the string.

--> statement-breakpoint
-- The apprentice / specialist / guest role extensions, removed 2026-06-13. The
-- columns outlived the subsystems by fourteen months.
ALTER TABLE `users` DROP COLUMN `mentor_id`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `assigned_section_ids`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `expires_at`;--> statement-breakpoint
-- The same two on the invite row, which carried them so accept could replay
-- them onto the new user. Accept never did.
ALTER TABLE `tenant_invites` DROP COLUMN `mentor_id`;--> statement-breakpoint
ALTER TABLE `tenant_invites` DROP COLUMN `assigned_section_ids`;--> statement-breakpoint
ALTER TABLE `tenant_configs` DROP COLUMN `is_apprentice_review_required`;--> statement-breakpoint
ALTER TABLE `tenant_configs` DROP COLUMN `is_guest_invites_enabled`;--> statement-breakpoint
-- `is_estimates_shown` gated a per-defect "Estimated cost" badge. By the time it
-- was dropped it gated nothing: the report service pins the payload's
-- `showEstimates` to false unconditionally, so no tenant's value ever reached a
-- renderer, and the writer refused every attempt to turn it on. One workspace
-- had it set — the developer's own test tenant, and the only two inspection
-- results in the database carrying an estimate snapshot belong to it.
ALTER TABLE `tenant_configs` DROP COLUMN `is_estimates_shown`;--> statement-breakpoint
-- Never written by any provisioning step, never read by any resolver.
ALTER TABLE `messaging_compliance` DROP COLUMN `subaccount_sid`;--> statement-breakpoint

-- The plaintext portal token. It was NOT NULL + UNIQUE, so every insert had to
-- put something in it, and what it put was a per-row sentinel — the real token
-- has only ever lived in the emailed link, in `token_hash` for lookup and in
-- `token_enc` for reconstruction. The column survived as a lazy-upgrade path for
-- rows predating the hash; production has none left (0 of 2 rows have a null
-- `token_hash`), so the branch could only ever miss. Its index goes first: SQLite
-- refuses to drop an indexed column, which is why this pair is one migration.
DROP INDEX `idx_iat_token`;--> statement-breakpoint
ALTER TABLE `inspection_access_tokens` DROP COLUMN `token`;--> statement-breakpoint

-- `concierge_confirm_tokens` made that same plaintext column its PRIMARY KEY,
-- which SQLite will not let go of — a PK column cannot be dropped at all. The
-- table is empty, so it is re-created instead of frozen: `id` becomes the
-- identity, `token_hash` becomes NOT NULL (it is the only way a presented token
-- resolves to a row), and the legacy foreign key to `inspections` goes, per the
-- Schema Rules' no-new-FK posture.
DROP TABLE `concierge_confirm_tokens`;--> statement-breakpoint
CREATE TABLE `concierge_confirm_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`inspection_id` text NOT NULL,
	`client_email` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`confirmed_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_concierge_tokens_expiry` ON `concierge_confirm_tokens` (`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_concierge_confirm_token_hash` ON `concierge_confirm_tokens` (`token_hash`);
