-- Agent Accounts A1 — Migration 0055
-- Pre-launch maneuver: rebuild `users` to make tenant_id nullable + email globally unique.
-- (SQLite ALTER cannot change NOT NULL; the only safe path is drop + recreate. Pre-launch
--  per project policy — see feedback_pre_launch_no_compat.md. Production-safe path would
--  require a multi-step migration: add nullable col -> copy data -> drop old.)
--
-- POST-REBASE NOTE: Sprint C's migration 0054 ships BEFORE this in the merge order
-- (already on main as of commit 838870f). 0054 adds photo_url / bio / service_areas
-- to users; this rebuild now includes those three columns so the migration is
-- idempotent against the post-C schema and does not drop Sprint C's data.
--
-- Column list mirrors the canonical users schema after migrations 0001 + 0004 + 0010 +
-- 0019 + 0020 + 0030 + 0052 + 0054.

-- D1 enforces foreign keys by default; defer them within the migration transaction so
-- DROP TABLE users (referenced by inspections, contacts, agreements, etc.) succeeds and
-- FK validity is re-checked at COMMIT against the rebuilt table (same row IDs preserved).
PRAGMA defer_foreign_keys = TRUE;

CREATE TABLE users_new (
    id                    TEXT    PRIMARY KEY,
    tenant_id             TEXT,                                  -- NULLABLE: NULL only when role='agent'
    email                 TEXT    NOT NULL,
    password_hash         TEXT    NOT NULL,
    role                  TEXT    NOT NULL DEFAULT 'admin',
    created_at            INTEGER NOT NULL,
    google_refresh_token  TEXT,
    google_calendar_id    TEXT,
    name                  TEXT,
    phone                 TEXT,
    license_number        TEXT,
    google_access_token   TEXT,
    google_token_expiry   INTEGER,
    locale                TEXT,
    onboarding_state      TEXT,
    totp_secret           TEXT,
    totp_enabled          INTEGER NOT NULL DEFAULT 0,
    totp_recovery_codes   TEXT,
    totp_verified_at      INTEGER,
    slug                  TEXT,
    photo_url             TEXT,
    bio                   TEXT,
    service_areas         TEXT
);

INSERT INTO users_new (
    id, tenant_id, email, password_hash, role, created_at,
    google_refresh_token, google_calendar_id, name, phone, license_number,
    google_access_token, google_token_expiry, locale, onboarding_state,
    totp_secret, totp_enabled, totp_recovery_codes, totp_verified_at, slug,
    photo_url, bio, service_areas
)
SELECT
    id, tenant_id, email, password_hash, role, created_at,
    google_refresh_token, google_calendar_id, name, phone, license_number,
    google_access_token, google_token_expiry, locale, onboarding_state,
    totp_secret, totp_enabled, totp_recovery_codes, totp_verified_at, slug,
    photo_url, bio, service_areas
FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

-- Email is now globally unique (was per-tenant via the SQLite UNIQUE column constraint).
-- Pre-launch dataset reset is fine; production-launch cohort would need a dedup script.
CREATE UNIQUE INDEX idx_users_email_global ON users(email);

-- Re-create the slug uniqueness index from migration 0052. Per-tenant unique, partial
-- so NULL slugs / NULL tenant_ids (agents) don't conflict.
CREATE UNIQUE INDEX idx_users_slug_per_tenant
    ON users(tenant_id, slug)
    WHERE slug IS NOT NULL AND tenant_id IS NOT NULL;

-- Restore the supporting non-unique indexes from migration 0001.
CREATE INDEX idx_users_tenant ON users(tenant_id);
CREATE INDEX idx_users_email ON users(email);
