CREATE TABLE inspection_units (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    inspection_id   TEXT NOT NULL,
    parent_unit_id  TEXT,
    kind            TEXT NOT NULL,
    name            TEXT NOT NULL,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX inspection_units_tenant_inspection_idx ON inspection_units (tenant_id, inspection_id);
CREATE INDEX inspection_units_parent_idx ON inspection_units (parent_unit_id);
