-- Migration: 0020_phase_t
-- Adds customer messages table + supporting columns for Phase T.

-- Customer messages: bidirectional async thread per inspection.
CREATE TABLE IF NOT EXISTS customer_messages (
    id            TEXT    PRIMARY KEY,
    tenant_id     TEXT    NOT NULL,
    inspection_id TEXT    NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
    from_role     TEXT    NOT NULL CHECK(from_role IN ('client', 'inspector')),
    from_name     TEXT,
    body          TEXT    NOT NULL,
    attachments   TEXT,
    read_at       INTEGER,
    created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_msg_inspection ON customer_messages(inspection_id, created_at);
CREATE INDEX IF NOT EXISTS idx_msg_unread     ON customer_messages(tenant_id, inspection_id, from_role) WHERE read_at IS NULL;

-- Public token for client message access; lazily generated on first inspector send.
ALTER TABLE inspections ADD COLUMN message_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_inspections_msg_token ON inspections(message_token);

-- User preferences for voice i18n + onboarding state.
ALTER TABLE users ADD COLUMN locale            TEXT;
ALTER TABLE users ADD COLUMN onboarding_state  TEXT;
