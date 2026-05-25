-- Migration: 0021_phase_t_fixes
-- Recreate customer_messages indexes/FKs as a partial index + cascade FK.
-- (SQLite cannot ALTER an existing FK; rebuild table is required.)

DROP INDEX IF EXISTS idx_msg_unread;
DROP INDEX IF EXISTS idx_msg_inspection;
DROP TABLE IF EXISTS customer_messages;

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
