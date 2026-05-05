-- Spec 4D — Inspection Events (Spectora-parity ancillary tasks)

CREATE TABLE event_types (
    id                     TEXT PRIMARY KEY,
    tenant_id              TEXT NOT NULL REFERENCES tenants(id),
    name                   TEXT NOT NULL,
    slug                   TEXT NOT NULL,
    default_duration_min   INTEGER NOT NULL DEFAULT 30,
    default_price_cents    INTEGER NOT NULL DEFAULT 0,
    color                  TEXT NOT NULL DEFAULT '#6366f1',
    sort_order             INTEGER NOT NULL DEFAULT 0,
    active                 INTEGER NOT NULL DEFAULT 1,
    created_at             INTEGER NOT NULL
);
CREATE UNIQUE INDEX event_types_tenant_slug_idx ON event_types (tenant_id, slug);

CREATE TABLE inspection_events (
    id                  TEXT PRIMARY KEY,
    tenant_id           TEXT NOT NULL REFERENCES tenants(id),
    inspection_id       TEXT NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
    event_type_id       TEXT NOT NULL REFERENCES event_types(id),
    inspector_id        TEXT REFERENCES users(id),
    scheduled_at        INTEGER NOT NULL,
    duration_min        INTEGER NOT NULL,
    price_cents         INTEGER NOT NULL DEFAULT 0,
    status              TEXT NOT NULL DEFAULT 'scheduled',
    notes               TEXT,
    completed_at        INTEGER,
    results_received_at INTEGER,
    cancelled_at        INTEGER,
    created_at          INTEGER NOT NULL
);
CREATE INDEX inspection_events_inspection_idx ON inspection_events (inspection_id);
CREATE INDEX inspection_events_scheduled_idx  ON inspection_events (tenant_id, scheduled_at);

ALTER TABLE automation_logs ADD COLUMN event_id TEXT REFERENCES inspection_events(id);
