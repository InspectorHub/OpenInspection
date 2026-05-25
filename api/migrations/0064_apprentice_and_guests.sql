CREATE TABLE apprentice_reviews (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    apprentice_id   TEXT NOT NULL,
    mentor_id       TEXT NOT NULL,
    inspection_id   TEXT NOT NULL,
    item_id         TEXT NOT NULL,
    field           TEXT NOT NULL,
    proposed_value  TEXT,
    status          TEXT NOT NULL DEFAULT 'pending',
    decision_value  TEXT,
    decision_at     INTEGER,
    submitted_at    INTEGER NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX apprentice_reviews_mentor_status_idx ON apprentice_reviews (tenant_id, mentor_id, status);
CREATE INDEX apprentice_reviews_apprentice_idx   ON apprentice_reviews (apprentice_id, status);
CREATE INDEX apprentice_reviews_inspection_item_idx ON apprentice_reviews (inspection_id, item_id);

CREATE TABLE guest_invites (
    id                  TEXT PRIMARY KEY,
    tenant_id           TEXT NOT NULL,
    token               TEXT UNIQUE NOT NULL,
    role                TEXT NOT NULL,
    duration_seconds    INTEGER NOT NULL,
    expires_at          INTEGER NOT NULL,
    claimed_by_user_id  TEXT,
    claimed_at          INTEGER,
    created_by          TEXT NOT NULL,
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX guest_invites_tenant_idx ON guest_invites (tenant_id);
CREATE INDEX guest_invites_token_idx  ON guest_invites (token);

ALTER TABLE users ADD COLUMN mentor_id TEXT;
ALTER TABLE users ADD COLUMN assigned_section_ids TEXT NOT NULL DEFAULT '[]';
ALTER TABLE users ADD COLUMN expires_at INTEGER;
