-- Migration: audit_logs
-- Tracks key tenant operations for compliance and debugging.

CREATE TABLE IF NOT EXISTS audit_logs (
    id          TEXT PRIMARY KEY,
    tenant_id   TEXT NOT NULL REFERENCES tenants(id),
    user_id     TEXT,                    -- null for system/M2M actions
    action      TEXT NOT NULL,           -- e.g. 'inspection.create', 'inspection.delete'
    entity_type TEXT NOT NULL,           -- e.g. 'inspection', 'template', 'user'
    entity_id   TEXT,                    -- ID of the affected record
    metadata    TEXT,                    -- JSON blob with before/after or extra context
    ip_address  TEXT,
    created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_tenant_created ON audit_logs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
