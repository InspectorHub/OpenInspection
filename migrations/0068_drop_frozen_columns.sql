-- Retires the five remaining columns whose schema comments claimed they could
-- never be removed. The claim rested on a rule that said D1 cannot alter a
-- table another table points at; what D1 actually cannot run is drizzle's
-- generated twelve-step rebuild, which copies a table aside, retires the
-- original, and renames the copy into place — unsafe outside a transaction
-- because D1 cannot relax foreign-key enforcement except inside one. A native
-- column removal has none of that machinery: it edits the one table in place.
-- Hand-written for that reason and never to be regenerated.
--
-- The index goes first. SQLite refuses a native column removal while an index
-- names the column, and `idx_comments_rating_bucket` names `rating_bucket`.
--
-- None of the five hits SQLite's other refusals: no primary key, no UNIQUE or
-- CHECK constraint, no foreign key, no generated column, no partial-index
-- predicate, no view. `helper_inspector_ids` and `data_version` are NOT NULL
-- with defaults, which is not a refusal — the constraint disappears with the
-- column.
--
-- This migration removes columns and deletes no rows. Every writer and every
-- reader of the five was retired ahead of it: assignment moved to
-- `inspection_inspectors`, comment severity to `comments.severity`, calendar
-- mapping to `calendar_external_links`, and the offline-staleness counter to
-- the collab document's own state vector.
DROP INDEX `idx_comments_rating_bucket`;--> statement-breakpoint
ALTER TABLE `comments` DROP COLUMN `rating_bucket`;--> statement-breakpoint
ALTER TABLE `inspection_events` DROP COLUMN `gcal_event_id`;--> statement-breakpoint
ALTER TABLE `inspections` DROP COLUMN `lead_inspector_id`;--> statement-breakpoint
ALTER TABLE `inspections` DROP COLUMN `helper_inspector_ids`;--> statement-breakpoint
ALTER TABLE `inspections` DROP COLUMN `data_version`;
