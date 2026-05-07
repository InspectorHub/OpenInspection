-- Migration: 0039_comments_rating_bucket
-- Adds rating_bucket and section columns to the comments library so user
-- snippets can be classified the same way the inspection-edit Library
-- drawer classifies the seeded 248-entry library
-- (satisfactory / monitor / defect / null=uncategorized).
--
-- Both columns are nullable; existing rows stay null and are surfaced
-- under the "All" tab on /comments and the "All" / "My snippets" tabs in
-- the Library drawer. No backfill required.
ALTER TABLE comments ADD COLUMN rating_bucket TEXT;
ALTER TABLE comments ADD COLUMN section TEXT;
CREATE INDEX IF NOT EXISTS idx_comments_rating_bucket ON comments(tenant_id, rating_bucket);
