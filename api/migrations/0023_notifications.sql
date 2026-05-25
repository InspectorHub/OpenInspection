-- B3: In-app notifications inbox.
-- userId NULL means tenant-wide (visible to all owner/admin); set userId to scope to one user.
-- readAt NULL means unread; archivedAt NULL means active inbox; non-null = archived/dismissed.
CREATE TABLE notifications (
    id TEXT PRIMARY KEY NOT NULL,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    entity_type TEXT,
    entity_id TEXT,
    metadata TEXT,
    read_at INTEGER,
    archived_at INTEGER,
    created_at INTEGER NOT NULL
);

CREATE INDEX idx_notifications_tenant_user_created
    ON notifications (tenant_id, user_id, created_at DESC);

CREATE INDEX idx_notifications_tenant_user_unread
    ON notifications (tenant_id, user_id, read_at)
    WHERE read_at IS NULL AND archived_at IS NULL;
