-- Sprint 2 Track 2 (S2-2) — Multi-inspection per request.
--
-- A single customer booking can group N inspections (Residential + Radon +
-- Termite, etc.) under one parent request. The previous 1:1 inspection model
-- is preserved through a backfill that wraps each existing inspection in its
-- own one-inspection request.
--
-- D1 doesn't support ALTER COLUMN, so the FK column is left nullable at the
-- DDL layer; the application enforces that every newly created inspection
-- carries a request_id.
--
-- T1 owns migration 0008_sprint2_schema.sql; this file ships separately as
-- 0041 (the next free slot in the migration log) per the dispatch coordination
-- note in the Track 2 plan.

CREATE TABLE inspection_requests (
    id                TEXT PRIMARY KEY,
    tenant_id         TEXT NOT NULL,
    client_name       TEXT NOT NULL,
    client_email      TEXT,
    client_phone      TEXT,
    property_address  TEXT NOT NULL,
    property_city     TEXT,
    property_state    TEXT,
    property_zip      TEXT,
    scheduled_at      TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','confirmed','in_progress','completed','cancelled')),
    notes             TEXT,
    total_amount      INTEGER NOT NULL DEFAULT 0,
    payment_status    TEXT NOT NULL DEFAULT 'unpaid'
        CHECK (payment_status IN ('unpaid','partial','paid')),
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL
);

CREATE INDEX idx_inspection_requests_tenant
    ON inspection_requests(tenant_id, status, scheduled_at);

CREATE INDEX idx_inspection_requests_email
    ON inspection_requests(tenant_id, client_email);

ALTER TABLE inspections ADD COLUMN request_id TEXT REFERENCES inspection_requests(id);
CREATE INDEX idx_inspections_request ON inspections(request_id);

-- Backfill: wrap each existing inspection in a one-inspection request so
-- dashboard "group by request" queries work uniformly. The deterministic
-- 'req-{inspection_id}' id makes the migration idempotent and easy to verify.
INSERT INTO inspection_requests (
    id, tenant_id, client_name, client_email, client_phone,
    property_address, scheduled_at, status, total_amount, payment_status,
    created_at, updated_at
)
SELECT
    'req-' || id,
    tenant_id,
    COALESCE(client_name, 'Private Client'),
    client_email,
    client_phone,
    COALESCE(property_address, ''),
    COALESCE(date, datetime('now')),
    CASE
        WHEN status = 'completed'   THEN 'completed'
        WHEN status = 'delivered'   THEN 'completed'
        WHEN status = 'in_progress' THEN 'in_progress'
        WHEN status = 'cancelled'   THEN 'cancelled'
        WHEN status = 'confirmed'   THEN 'confirmed'
        ELSE 'pending'
    END,
    COALESCE(price, 0),
    COALESCE(payment_status, 'unpaid'),
    COALESCE(CAST(strftime('%s', created_at) AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    COALESCE(CAST(strftime('%s', created_at) AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000)
FROM inspections
WHERE request_id IS NULL;

UPDATE inspections SET request_id = 'req-' || id WHERE request_id IS NULL;
