-- Spec 2A — extend agreement_requests with sent_at + last_error;
-- Also extend the status CHECK constraint to include the new states:
-- sent, declined, expired.
-- SQLite cannot DROP CONSTRAINT, so we recreate the table.

PRAGMA foreign_keys = OFF;

CREATE TABLE agreement_requests_new (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    inspection_id TEXT REFERENCES inspections(id),
    agreement_id TEXT NOT NULL REFERENCES agreements(id),
    client_email TEXT NOT NULL,
    client_name TEXT,
    token TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'sent', 'viewed', 'signed', 'declined', 'expired')),
    signature_base64 TEXT,
    signed_at INTEGER,
    viewed_at INTEGER,
    sent_at INTEGER,
    last_error TEXT,
    created_at INTEGER NOT NULL
);

INSERT INTO agreement_requests_new
    (id, tenant_id, inspection_id, agreement_id, client_email, client_name,
     token, status, signature_base64, signed_at, viewed_at, sent_at, last_error, created_at)
SELECT id, tenant_id, inspection_id, agreement_id, client_email, client_name,
       token, status, signature_base64, signed_at, viewed_at, NULL, NULL, created_at
FROM agreement_requests;

DROP TABLE agreement_requests;
ALTER TABLE agreement_requests_new RENAME TO agreement_requests;

CREATE INDEX idx_agreement_requests_tenant ON agreement_requests(tenant_id);
CREATE INDEX idx_agreement_requests_token ON agreement_requests(token);
CREATE INDEX idx_agreement_requests_inspection ON agreement_requests(inspection_id);

PRAGMA foreign_keys = ON;
