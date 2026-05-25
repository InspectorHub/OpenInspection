-- Auth & Multi-Tenancy Schema
-- tenants must be created before users (foreign key dependency)

CREATE TABLE IF NOT EXISTS tenants (
    id          TEXT    PRIMARY KEY,
    name        TEXT    NOT NULL,
    subdomain   TEXT    NOT NULL UNIQUE,
    tier        TEXT    NOT NULL DEFAULT 'free',        -- free, pro, enterprise
    status      TEXT    NOT NULL DEFAULT 'pending',     -- pending, trialing, active, past_due, suspended
    max_users   INTEGER NOT NULL DEFAULT 5,
    created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
    id            TEXT    PRIMARY KEY,
    tenant_id     TEXT    NOT NULL REFERENCES tenants(id),
    email         TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL DEFAULT 'admin',     -- admin, inspector, viewer
    created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tenant_invites (
    id          TEXT    PRIMARY KEY,                    -- serves as the invite token
    tenant_id   TEXT    NOT NULL REFERENCES tenants(id),
    email       TEXT    NOT NULL,
    role        TEXT    NOT NULL DEFAULT 'inspector',   -- admin, inspector, viewer
    status      TEXT    NOT NULL DEFAULT 'pending',     -- pending, accepted, expired
    expires_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_tenant  ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_email   ON users(email);
CREATE INDEX IF NOT EXISTS idx_invites_tenant ON tenant_invites(tenant_id);
