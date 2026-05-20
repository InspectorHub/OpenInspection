-- Spec 2A — extend automations.trigger CHECK to allow new agreement.* events.
-- SQLite cannot ALTER CHECK; standard workaround = create_new + INSERT SELECT
-- + DROP old + RENAME.
--
-- D1 batches statements implicitly via the Workers Storage API; the
-- explicit BEG-IN / COM-MIT control keywords are not permitted in
-- --file execution (each statement is committed independently).
-- Cannot use PRAGMA defer_foreign_keys to bridge the FK gap from
-- automation_logs.automation_id → automations.id during the table swap.
--
-- Resolution: recreate automation_logs FIRST without the FK (orphaned-log
-- protection lost — but acceptable; logs are emails-already-sent, never
-- delete automation rules in practice). Then safely drop+recreate
-- automations with extended CHECK.

CREATE TABLE automation_logs_new (
    id              TEXT    PRIMARY KEY,
    tenant_id       TEXT    NOT NULL,
    automation_id   TEXT    NOT NULL,
    inspection_id   TEXT    NOT NULL,
    recipient_email TEXT    NOT NULL,
    send_at         TEXT    NOT NULL,
    delivered_at    TEXT,
    status          TEXT    NOT NULL DEFAULT 'pending'
                    CHECK(status IN ('pending','sent','failed','skipped')),
    error           TEXT
);

INSERT INTO automation_logs_new
    (id, tenant_id, automation_id, inspection_id, recipient_email, send_at, delivered_at, status, error)
SELECT id, tenant_id, automation_id, inspection_id, recipient_email, send_at, delivered_at, status, error
FROM automation_logs;

DROP TABLE automation_logs;

ALTER TABLE automation_logs_new RENAME TO automation_logs;

CREATE INDEX idx_automation_logs_pending ON automation_logs(tenant_id, status, send_at);
CREATE INDEX idx_automation_logs_insp    ON automation_logs(inspection_id);

CREATE TABLE automations_new (
    id               TEXT    PRIMARY KEY,
    tenant_id        TEXT    NOT NULL REFERENCES tenants(id),
    name             TEXT    NOT NULL,
    trigger          TEXT    NOT NULL CHECK(trigger IN (
                       'inspection.created','inspection.confirmed','inspection.cancelled',
                       'report.published','invoice.created','payment.received',
                       'agreement.signed','agreement.viewed','agreement.declined','agreement.expired'
                     )),
    recipient        TEXT    NOT NULL CHECK(recipient IN ('client','buying_agent','selling_agent','inspector','all')),
    delay_minutes    INTEGER NOT NULL DEFAULT 0,
    subject_template TEXT    NOT NULL,
    body_template    TEXT    NOT NULL,
    active           INTEGER NOT NULL DEFAULT 1,
    is_default       INTEGER NOT NULL DEFAULT 0,
    created_at       INTEGER NOT NULL
);

INSERT INTO automations_new
    (id, tenant_id, name, trigger, recipient, delay_minutes,
     subject_template, body_template, active, is_default, created_at)
SELECT id, tenant_id, name, trigger, recipient, delay_minutes,
       subject_template, body_template, active, is_default, created_at
FROM automations;

DROP TABLE automations;

ALTER TABLE automations_new RENAME TO automations;

CREATE INDEX idx_automations_tenant ON automations(tenant_id);
