-- 0009_comments_item_label_and_usage.sql
-- Comments Library Upgrade — item_label tagging + per-user usage tracking.

-- 1) item_label on comments (nullable; existing rows NULL).
ALTER TABLE comments ADD COLUMN item_label TEXT;

-- 2) per-user usage pivot table.
CREATE TABLE comment_usage (
    tenant_id    TEXT    NOT NULL,
    user_id      TEXT    NOT NULL,
    comment_id   TEXT    NOT NULL,
    use_count    INTEGER NOT NULL DEFAULT 0,
    last_used_at INTEGER,
    PRIMARY KEY (tenant_id, user_id, comment_id),
    FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE
);

CREATE INDEX idx_comment_usage_user_last_used
    ON comment_usage (tenant_id, user_id, last_used_at DESC);
