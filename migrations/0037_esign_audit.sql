-- Spec 5H P0 — Self-built e-signature audit foundation
-- Per-tenant Ed25519 signing keys + hash-chained audit log

CREATE TABLE signing_keys (
    tenant_id        TEXT PRIMARY KEY NOT NULL REFERENCES tenants(id),
    public_key       TEXT NOT NULL,
    private_key_enc  TEXT NOT NULL,
    private_key_iv   TEXT NOT NULL,
    fingerprint      TEXT NOT NULL,
    algorithm        TEXT NOT NULL DEFAULT 'Ed25519',
    created_at       INTEGER NOT NULL,
    rotated_at       INTEGER
);

CREATE TABLE esign_audit_logs (
    id               TEXT PRIMARY KEY NOT NULL,
    tenant_id        TEXT NOT NULL,
    request_id       TEXT NOT NULL,
    event            TEXT NOT NULL,
    payload_json     TEXT NOT NULL,
    prev_hash        TEXT,
    hash             TEXT NOT NULL,
    signature        TEXT NOT NULL,
    key_fingerprint  TEXT NOT NULL,
    created_at       INTEGER NOT NULL
);
CREATE INDEX idx_esign_audit_logs_request ON esign_audit_logs(tenant_id, request_id, created_at);
CREATE UNIQUE INDEX idx_esign_audit_logs_event_dedup ON esign_audit_logs(tenant_id, request_id, event)
    WHERE event IN ('agreement.signed', 'workflow.complete');
