CREATE TABLE observer_links (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    inspection_id   TEXT NOT NULL,
    token           TEXT UNIQUE NOT NULL,
    created_by      TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at      INTEGER NOT NULL,
    revoked_at      INTEGER,
    last_viewed_at  INTEGER
);
CREATE INDEX observer_links_token_idx ON observer_links (token);
CREATE INDEX observer_links_inspection_idx ON observer_links (inspection_id);
