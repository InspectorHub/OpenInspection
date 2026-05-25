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

-- event_id added without FK constraint (matches automation_logs FK-less style after migration 0028)
ALTER TABLE automation_logs ADD COLUMN event_id TEXT;

-- Extend automations.trigger CHECK to allow event.created + event.completed.
-- Same recreate-table dance as 0028 (SQLite cannot ALTER CHECK).

CREATE TABLE automations_new (
    id               TEXT    PRIMARY KEY,
    tenant_id        TEXT    NOT NULL REFERENCES tenants(id),
    name             TEXT    NOT NULL,
    trigger          TEXT    NOT NULL CHECK(trigger IN (
                       'inspection.created','inspection.confirmed','inspection.cancelled',
                       'report.published','invoice.created','payment.received',
                       'agreement.signed','agreement.viewed','agreement.declined','agreement.expired',
                       'event.created','event.completed'
                     )),
    recipient        TEXT    NOT NULL CHECK(recipient IN ('client','buying_agent','selling_agent','inspector','all')),
    delay_minutes    INTEGER NOT NULL DEFAULT 0,
    subject_template TEXT    NOT NULL,
    body_template    TEXT    NOT NULL,
    active           INTEGER NOT NULL DEFAULT 1,
    is_default       INTEGER NOT NULL DEFAULT 0,
    created_at       INTEGER NOT NULL
);

INSERT INTO automations_new
    (id, tenant_id, name, trigger, recipient, delay_minutes,
     subject_template, body_template, active, is_default, created_at)
SELECT id, tenant_id, name, trigger, recipient, delay_minutes,
       subject_template, body_template, active, is_default, created_at
FROM automations;

DROP TABLE automations;

ALTER TABLE automations_new RENAME TO automations;

CREATE INDEX idx_automations_tenant ON automations(tenant_id);
