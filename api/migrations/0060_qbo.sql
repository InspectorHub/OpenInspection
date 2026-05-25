-- QBO OAuth connections (one per tenant)
CREATE TABLE IF NOT EXISTS qbo_connections (
    tenant_id                TEXT PRIMARY KEY,
    realm_id                 TEXT NOT NULL,
    company_name             TEXT,
    access_token             TEXT NOT NULL,
    refresh_token            TEXT NOT NULL,
    token_expires_at         INTEGER NOT NULL,
    refresh_token_expires_at INTEGER NOT NULL,
    last_sync_at             INTEGER,
    sync_enabled             INTEGER NOT NULL DEFAULT 1,
    default_item_id          TEXT NOT NULL DEFAULT '1',
    created_at               INTEGER NOT NULL
);

-- OI <-> QBO entity ID mapping
CREATE TABLE IF NOT EXISTS qbo_entity_map (
    id             TEXT PRIMARY KEY,
    tenant_id      TEXT NOT NULL,
    oi_type        TEXT NOT NULL,
    oi_id          TEXT NOT NULL,
    qbo_type       TEXT NOT NULL,
    qbo_id         TEXT NOT NULL,
    qbo_sync_token TEXT NOT NULL,
    synced_at      INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_qbo_entity_map_oi
    ON qbo_entity_map(tenant_id, oi_type, oi_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_qbo_entity_map_qbo
    ON qbo_entity_map(tenant_id, qbo_type, qbo_id);

-- Sync error log with retry tracking
CREATE TABLE IF NOT EXISTS qbo_sync_errors (
    id          TEXT PRIMARY KEY,
    tenant_id   TEXT NOT NULL,
    oi_type     TEXT NOT NULL,
    oi_id       TEXT NOT NULL,
    error_code  TEXT NOT NULL,
    error_msg   TEXT NOT NULL,
    retries     INTEGER NOT NULL DEFAULT 0,
    resolved    INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

-- Invoice table additions
ALTER TABLE invoices ADD COLUMN partial_paid_at INTEGER;
ALTER TABLE invoices ADD COLUMN qbo_sync_status TEXT;
