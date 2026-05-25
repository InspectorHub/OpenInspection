-- Inspection Engine Schema
-- Depends on: 0001_auth.sql (tenants, users)

-- Inspection form definitions. The entire nested checklist structure
-- (sections → items → fields) is stored as a JSON blob in `schema`.
CREATE TABLE IF NOT EXISTS templates (
    id          TEXT    PRIMARY KEY,
    tenant_id   TEXT    NOT NULL REFERENCES tenants(id),
    name        TEXT    NOT NULL,
    version     INTEGER NOT NULL DEFAULT 1,
    schema      TEXT    NOT NULL,   -- JSON: { sections: [{ title, items: [{ id, label, type }] }] }
    created_at  INTEGER NOT NULL
);

-- One record per scheduled or completed inspection job.
CREATE TABLE IF NOT EXISTS inspections (
    id               TEXT    PRIMARY KEY,
    tenant_id        TEXT    NOT NULL REFERENCES tenants(id),
    inspector_id     TEXT             REFERENCES users(id),
    property_address TEXT    NOT NULL,
    client_name      TEXT,
    client_email     TEXT,
    template_id      TEXT             REFERENCES templates(id),
    date             TEXT    NOT NULL,                          -- ISO 8601 datetime string
    status           TEXT    NOT NULL DEFAULT 'draft',          -- draft, completed, delivered
    payment_status   TEXT    NOT NULL DEFAULT 'unpaid',         -- unpaid, paid
    price            INTEGER NOT NULL DEFAULT 0,                -- in cents
    created_at       INTEGER NOT NULL
);

-- Sparse JSON map of collected field values for a single inspection session.
-- Key = item id from templates.schema, value = { status, notes, media[] }
CREATE TABLE IF NOT EXISTS inspection_results (
    id              TEXT    PRIMARY KEY,
    tenant_id       TEXT    NOT NULL REFERENCES tenants(id),
    inspection_id   TEXT    NOT NULL REFERENCES inspections(id),
    data            TEXT    NOT NULL,   -- JSON sparse map
    last_synced_at  INTEGER NOT NULL
);

-- Legal agreement templates defined per tenant (e.g. inspection terms & conditions).
CREATE TABLE IF NOT EXISTS agreements (
    id          TEXT    PRIMARY KEY,
    tenant_id   TEXT    NOT NULL REFERENCES tenants(id),
    name        TEXT    NOT NULL,
    content     TEXT    NOT NULL,   -- Markdown or HTML
    version     INTEGER NOT NULL DEFAULT 1,
    created_at  INTEGER NOT NULL
);

-- A signed instance of an agreement for one inspection.
CREATE TABLE IF NOT EXISTS inspection_agreements (
    id                TEXT    PRIMARY KEY,
    tenant_id         TEXT    NOT NULL REFERENCES tenants(id),
    inspection_id     TEXT    NOT NULL REFERENCES inspections(id),
    signature_base64  TEXT    NOT NULL,
    signed_at         INTEGER NOT NULL,
    ip_address        TEXT,
    user_agent        TEXT
);

-- Inspector's recurring weekly availability windows.
CREATE TABLE IF NOT EXISTS availability (
    id            TEXT    PRIMARY KEY,
    tenant_id     TEXT    NOT NULL REFERENCES tenants(id),
    inspector_id  TEXT    NOT NULL REFERENCES users(id),
    day_of_week   INTEGER NOT NULL,   -- 0 = Sunday, 6 = Saturday
    start_time    TEXT    NOT NULL,   -- "HH:mm"
    end_time      TEXT    NOT NULL,   -- "HH:mm"
    created_at    INTEGER NOT NULL
);

-- Date-specific overrides: extra slots or full block-outs.
CREATE TABLE IF NOT EXISTS availability_overrides (
    id            TEXT    PRIMARY KEY,
    tenant_id     TEXT    NOT NULL REFERENCES tenants(id),
    inspector_id  TEXT    NOT NULL REFERENCES users(id),
    date          TEXT    NOT NULL,                         -- "YYYY-MM-DD"
    is_available  INTEGER NOT NULL DEFAULT 0,              -- 1 = extra slot, 0 = blocked
    start_time    TEXT,                                    -- null when is_available = 0
    end_time      TEXT,                                    -- null when is_available = 0
    created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inspections_tenant      ON inspections(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inspections_inspector   ON inspections(inspector_id);
CREATE INDEX IF NOT EXISTS idx_inspections_status      ON inspections(status);
CREATE INDEX IF NOT EXISTS idx_results_tenant          ON inspection_results(tenant_id);
CREATE INDEX IF NOT EXISTS idx_results_inspection      ON inspection_results(inspection_id);
CREATE INDEX IF NOT EXISTS idx_agreements_tenant       ON agreements(tenant_id);
CREATE INDEX IF NOT EXISTS idx_insp_agreements_insp    ON inspection_agreements(inspection_id);
CREATE INDEX IF NOT EXISTS idx_insp_agreements_tenant  ON inspection_agreements(tenant_id);
CREATE INDEX IF NOT EXISTS idx_availability_inspector  ON availability(inspector_id);
CREATE INDEX IF NOT EXISTS idx_avail_overrides_insp    ON availability_overrides(inspector_id);
