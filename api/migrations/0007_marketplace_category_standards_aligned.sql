-- Expand marketplace_templates.category CHECK constraint to include
-- 'standards_aligned', which the seed script (scripts/seed-marketplace.js)
-- uses for the InterNACHI 13-section standards-aligned template (S3-5).
-- Without this, seed:marketplace:remote aborts on the first INSERT and
-- the table stays empty.
--
-- SQLite has no ALTER CONSTRAINT, so we recreate the table. Idempotent
-- via the standard rename dance, and safe because no production data is
-- lost (existing rows are preserved).

CREATE TABLE marketplace_templates_new (
  id             TEXT    PRIMARY KEY,
  name           TEXT    NOT NULL,
  category       TEXT    NOT NULL
                   CHECK(category IN ('residential','commercial','trec','condo','new_construction','standards_aligned')),
  semver         TEXT    NOT NULL,
  schema         TEXT    NOT NULL,
  author_id      TEXT    NOT NULL DEFAULT 'system',
  changelog      TEXT,
  download_count INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT    NOT NULL,
  updated_at     TEXT    NOT NULL,
  featured       INTEGER NOT NULL DEFAULT 0
);

INSERT INTO marketplace_templates_new
  (id, name, category, semver, schema, author_id, changelog, download_count, created_at, updated_at, featured)
  SELECT id, name, category, semver, schema, author_id, changelog, download_count, created_at, updated_at, featured
    FROM marketplace_templates;

DROP TABLE marketplace_templates;

ALTER TABLE marketplace_templates_new RENAME TO marketplace_templates;
