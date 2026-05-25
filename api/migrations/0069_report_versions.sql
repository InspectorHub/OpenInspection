CREATE TABLE report_versions (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    inspection_id   TEXT NOT NULL,
    version_number  INTEGER NOT NULL,
    snapshot_json   TEXT NOT NULL,
    summary         TEXT,
    published_at    INTEGER NOT NULL,
    published_by    TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (inspection_id, version_number)
);
CREATE INDEX report_versions_inspection_idx ON report_versions (inspection_id, version_number);
