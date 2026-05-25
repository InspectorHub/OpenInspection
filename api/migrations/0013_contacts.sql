CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    type TEXT NOT NULL DEFAULT 'client' CHECK (type IN ('agent', 'client')),
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    agency TEXT,
    notes TEXT,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contacts_tenant ON contacts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_contacts_type ON contacts(tenant_id, type);
