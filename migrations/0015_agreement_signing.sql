-- Agreement signing requests: track sent agreements and client signatures
CREATE TABLE agreement_requests (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    inspection_id TEXT REFERENCES inspections(id),
    agreement_id TEXT NOT NULL REFERENCES agreements(id),
    client_email TEXT NOT NULL,
    client_name TEXT,
    token TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'viewed', 'signed')),
    signature_base64 TEXT,
    signed_at INTEGER,
    viewed_at INTEGER,
    created_at INTEGER NOT NULL
);

CREATE INDEX idx_agreement_requests_tenant ON agreement_requests(tenant_id);
CREATE INDEX idx_agreement_requests_token ON agreement_requests(token);
CREATE INDEX idx_agreement_requests_inspection ON agreement_requests(inspection_id);
