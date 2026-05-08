-- Sprint 2 Track 3 (S2-7 + S2-8) — Marketplace import history + library row provenance.
--
-- 1) `tenant_marketplace_import_history` records every install/update/replace/migrate
--    event so admins can audit "why did this 248-comment library balloon to 496?" or
--    "when was the new template version pulled in?". One row per event. Metadata is
--    JSON to capture flow-specific details (e.g. migrated inspection ids, deleted
--    template id, user-edit row count lost on replace).
--
-- 2) `comments.library_id` lets the new "replace" mode (S2-7) cleanly delete the
--    rows of a prior import without touching tenant-authored comments. Nullable so
--    legacy rows / locally-created comments remain untouched.

CREATE TABLE IF NOT EXISTS tenant_marketplace_import_history (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    library_id      TEXT,                                        -- null when this row tracks a template event
    template_id     TEXT,                                        -- null when this row tracks a library event
    action          TEXT NOT NULL CHECK (action IN ('install','update','replace','migrate')),
    source_version  TEXT,                                        -- previous semver (null on first install)
    target_version  TEXT,                                        -- new semver (null on migrate where versions don't apply)
    rows_affected   INTEGER NOT NULL DEFAULT 0,
    metadata        TEXT,                                        -- JSON blob — extra context per action
    created_at      INTEGER NOT NULL,
    created_by      TEXT NOT NULL                                -- user id who triggered the action
);
CREATE INDEX IF NOT EXISTS idx_marketplace_history_tenant
    ON tenant_marketplace_import_history(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketplace_history_template
    ON tenant_marketplace_import_history(template_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_history_library
    ON tenant_marketplace_import_history(library_id);

-- Track which library a comment originated from, so the replace mode can delete
-- prior-import rows precisely. Locally authored comments stay null and are never
-- touched by replace mode.
ALTER TABLE comments ADD COLUMN library_id TEXT;
CREATE INDEX IF NOT EXISTS idx_comments_library_id ON comments(library_id);
