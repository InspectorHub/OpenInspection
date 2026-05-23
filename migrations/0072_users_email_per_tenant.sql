-- 2026-05-23 — Per-tenant email uniqueness
--
-- Backing the multi-workspace identity model in portal: a single human
-- (one portal identity) can belong to multiple workspaces, and portal
-- pushes one `users` row to core per membership — so the globally
-- UNIQUE constraint on `users.email` blocks the second push.
--
-- Move uniqueness from (email) to (tenant_id, email). Same email is now
-- allowed across different tenants; still UNIQUE within a tenant.
--
-- D1 / SQLite caveat: you cannot DROP a UNIQUE constraint that was
-- declared inline with the column, so this migration recreates the
-- table. The column list mirrors src/lib/db/schema/tenant.ts at the
-- time of writing — keep them in lock-step.
--
-- defer_foreign_keys is REQUIRED here. Many tables (inspections,
-- audit_logs, bookings, …) carry FK references into users(id); a
-- naive DROP TABLE users mid-rebuild trips SQLITE_CONSTRAINT_FOREIGNKEY
-- because for the duration of (DROP + RENAME) those FKs point at a
-- non-existent target. `defer_foreign_keys = TRUE` postpones the check
-- to COMMIT, by which time users_new has been renamed back to users
-- and every FK row still resolves to the same id it did before. D1
-- supports this PRAGMA (unlike `foreign_keys = OFF`, which D1 ignores).
-- Mirrors migration 0055 (already on prod) which uses the same pattern.
PRAGMA defer_foreign_keys = TRUE;

-- IMPORTANT: tenant_id is NOT declared `REFERENCES tenants(id)` here, even
-- though that looks tempting. Migration 0055 deliberately dropped that FK
-- because prod has user rows whose tenant was deleted out from under them
-- (or never inserted in the agent-account path). Re-introducing the FK
-- would fail INSERT INTO users_new on every orphaned row. The tenant_id
-- column type + nullability is preserved; tenant scoping is enforced at
-- the application layer (see Tenant Isolation Rules in CLAUDE.md), not
-- by SQL FK.
CREATE TABLE users_new (
    id                     TEXT PRIMARY KEY,
    tenant_id              TEXT,
    email                  TEXT NOT NULL,
    password_hash          TEXT NOT NULL,
    name                   TEXT,
    phone                  TEXT,
    license_number         TEXT,
    photo_url              TEXT,
    bio                    TEXT,
    service_areas          TEXT,
    slug                   TEXT,
    role                   TEXT NOT NULL DEFAULT 'admin',
    google_refresh_token   TEXT,
    google_calendar_id     TEXT,
    google_access_token    TEXT,
    google_token_expiry    INTEGER,
    locale                 TEXT,
    onboarding_state       TEXT,
    created_at             INTEGER NOT NULL,
    totp_secret            TEXT,
    totp_enabled           INTEGER NOT NULL DEFAULT 0,
    totp_recovery_codes    TEXT,
    totp_verified_at       INTEGER,
    notify_on_referral     INTEGER NOT NULL DEFAULT 1,
    notify_on_report       INTEGER NOT NULL DEFAULT 1,
    notify_on_paid         INTEGER NOT NULL DEFAULT 0,
    last_active_at         INTEGER,
    mentor_id              TEXT,
    assigned_section_ids   TEXT NOT NULL DEFAULT '[]',
    expires_at             INTEGER,
    signup_role            TEXT
);

INSERT INTO users_new SELECT
    id, tenant_id, email, password_hash, name, phone, license_number,
    photo_url, bio, service_areas, slug, role,
    google_refresh_token, google_calendar_id, google_access_token, google_token_expiry,
    locale, onboarding_state, created_at,
    totp_secret, totp_enabled, totp_recovery_codes, totp_verified_at,
    notify_on_referral, notify_on_report, notify_on_paid,
    last_active_at, mentor_id, assigned_section_ids, expires_at, signup_role
FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

-- New UNIQUE: (tenant_id, email). NULL tenant_id (agent global account)
-- can still have at most one row per email, since SQLite treats NULL
-- as distinct in UNIQUE indexes — we accept that semantics, which
-- matches the existing agent_tenant_links design.
CREATE UNIQUE INDEX users_tenant_email_unique ON users(tenant_id, email);

-- Re-create the partial per-tenant slug index (was idx_users_slug_per_tenant
-- in migration 0052) — table rebuild dropped it.
CREATE UNIQUE INDEX idx_users_slug_per_tenant
    ON users(tenant_id, slug)
    WHERE slug IS NOT NULL;
