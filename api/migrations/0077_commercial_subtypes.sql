-- Gap 16 Phase A: Commercial subtypes table for org-custom subtypes.
-- Platform subtypes (office/retail/hospitality/industrial/institutional/mixed-use)
-- are constants in code, not stored here.
CREATE TABLE IF NOT EXISTS commercial_subtypes (
    id          TEXT PRIMARY KEY,
    tenant_id   TEXT NOT NULL REFERENCES tenants(id),
    name        TEXT NOT NULL,
    based_on    TEXT,
    description TEXT,
    disabled    INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    UNIQUE(tenant_id, name)
);
