-- Migration: 0016_parity_schema
-- Adds all tables and columns required for Spectora/ITB migration parity (Phases 1-5).
-- Run once; all phases build on top of this schema.

-- ── New tables ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS services (
  id               TEXT    PRIMARY KEY,
  tenant_id        TEXT    NOT NULL REFERENCES tenants(id),
  name             TEXT    NOT NULL,
  description      TEXT,
  price            INTEGER NOT NULL,            -- cents
  duration_minutes INTEGER,
  template_id      TEXT REFERENCES templates(id),
  agreement_id     TEXT REFERENCES agreements(id),
  active           INTEGER NOT NULL DEFAULT 1,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_services_tenant ON services(tenant_id);

CREATE TABLE IF NOT EXISTS inspection_services (
  id             TEXT    PRIMARY KEY,
  tenant_id      TEXT    NOT NULL REFERENCES tenants(id),
  inspection_id  TEXT    NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  service_id     TEXT    NOT NULL REFERENCES services(id),   -- no ON DELETE: use services.active=0 for soft-delete
  price_override INTEGER,
  name_snapshot  TEXT    NOT NULL,
  price_snapshot INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_insp_services_insp   ON inspection_services(inspection_id);
CREATE INDEX IF NOT EXISTS idx_insp_services_tenant ON inspection_services(tenant_id);

CREATE TABLE IF NOT EXISTS discount_codes (
  id          TEXT    PRIMARY KEY,
  tenant_id   TEXT    NOT NULL REFERENCES tenants(id),
  code        TEXT    NOT NULL,
  type        TEXT    NOT NULL CHECK(type IN ('fixed','percent')),
  value       INTEGER NOT NULL,
  max_uses    INTEGER,
  uses_count  INTEGER NOT NULL DEFAULT 0,
  expires_at  TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS discount_codes_code_tenant ON discount_codes(UPPER(code), tenant_id);
CREATE INDEX        IF NOT EXISTS idx_discount_codes_tenant  ON discount_codes(tenant_id);

CREATE TABLE IF NOT EXISTS automations (
  id               TEXT    PRIMARY KEY,
  tenant_id        TEXT    NOT NULL REFERENCES tenants(id),
  name             TEXT    NOT NULL,
  trigger          TEXT    NOT NULL CHECK(trigger IN (
                     'inspection.created','inspection.confirmed','inspection.cancelled',
                     'report.published','invoice.created','payment.received','agreement.signed'
                   )),
  recipient        TEXT    NOT NULL CHECK(recipient IN ('client','buying_agent','selling_agent','inspector','all')),
  delay_minutes    INTEGER NOT NULL DEFAULT 0,
  subject_template TEXT    NOT NULL,
  body_template    TEXT    NOT NULL,
  active           INTEGER NOT NULL DEFAULT 1,
  is_default       INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_automations_tenant ON automations(tenant_id);

CREATE TABLE IF NOT EXISTS automation_logs (
  id              TEXT    PRIMARY KEY,
  tenant_id       TEXT    NOT NULL REFERENCES tenants(id),
  automation_id   TEXT    NOT NULL REFERENCES automations(id),
  inspection_id   TEXT    NOT NULL REFERENCES inspections(id),
  recipient_email TEXT    NOT NULL,
  send_at         TEXT    NOT NULL,
  delivered_at    TEXT,
  status          TEXT    NOT NULL DEFAULT 'pending'
                  CHECK(status IN ('pending','sent','failed','skipped')),
  error           TEXT
);
CREATE INDEX IF NOT EXISTS idx_automation_logs_pending ON automation_logs(tenant_id, status, send_at);
CREATE INDEX IF NOT EXISTS idx_automation_logs_insp    ON automation_logs(inspection_id);

-- ── New columns on inspections ────────────────────────────────────────────────

ALTER TABLE inspections ADD COLUMN confirmed_at       TEXT;
ALTER TABLE inspections ADD COLUMN cancel_reason      TEXT;
ALTER TABLE inspections ADD COLUMN payment_required   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inspections ADD COLUMN agreement_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inspections ADD COLUMN discount_code_id   TEXT REFERENCES discount_codes(id);
ALTER TABLE inspections ADD COLUMN discount_amount    INTEGER;
ALTER TABLE inspections ADD COLUMN closing_date       TEXT;
ALTER TABLE inspections ADD COLUMN referral_source    TEXT;
ALTER TABLE inspections ADD COLUMN order_id           TEXT;
ALTER TABLE inspections ADD COLUMN internal_notes     TEXT;
ALTER TABLE inspections ADD COLUMN year_built         INTEGER;
ALTER TABLE inspections ADD COLUMN sqft               INTEGER;
ALTER TABLE inspections ADD COLUMN foundation_type    TEXT;
ALTER TABLE inspections ADD COLUMN bedrooms           INTEGER;
ALTER TABLE inspections ADD COLUMN bathrooms          REAL;
ALTER TABLE inspections ADD COLUMN unit               TEXT;
ALTER TABLE inspections ADD COLUMN county             TEXT;
ALTER TABLE inspections ADD COLUMN selling_agent_id   TEXT REFERENCES contacts(id);
ALTER TABLE inspections ADD COLUMN disable_automations INTEGER NOT NULL DEFAULT 0;
