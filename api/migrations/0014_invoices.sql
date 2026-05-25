CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    inspection_id TEXT REFERENCES inspections(id),
    client_name TEXT,
    client_email TEXT,
    amount_cents INTEGER NOT NULL DEFAULT 0,
    line_items TEXT NOT NULL DEFAULT '[]',
    due_date TEXT,
    notes TEXT,
    sent_at INTEGER,
    paid_at INTEGER,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant ON invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_invoices_inspection ON invoices(inspection_id);
