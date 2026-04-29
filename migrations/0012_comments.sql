-- Inspection comment library (pre-saved phrases for inspectors)
CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    text TEXT NOT NULL,
    category TEXT,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_tenant ON comments(tenant_id);
