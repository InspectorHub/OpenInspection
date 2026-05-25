-- Agent Accounts A1 — Migration 0056
-- agent_tenant_links: N:N relationship between global agent users (users.tenant_id IS NULL)
-- and the tenants they have access to. Created either by accepting an invite or by the
-- same-email auto-link routine that promotes matching contact rows.
--
-- agent_invites: 7-day TTL invite tokens minted by inspectors via POST /api/agents/invite.

CREATE TABLE agent_tenant_links (
    id                    TEXT    PRIMARY KEY,
    agent_user_id         TEXT    NOT NULL REFERENCES users(id),
    tenant_id             TEXT    NOT NULL REFERENCES tenants(id),
    inspector_contact_id  TEXT,
    status                TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('pending','active','revoked')),
    invited_by_user_id    TEXT,
    created_at            INTEGER NOT NULL,
    revoked_at            INTEGER
);

CREATE UNIQUE INDEX idx_agent_tenant_unique   ON agent_tenant_links(agent_user_id, tenant_id);
CREATE        INDEX idx_agent_tenant_by_tenant ON agent_tenant_links(tenant_id, status);
CREATE        INDEX idx_agent_tenant_by_agent  ON agent_tenant_links(agent_user_id, status);

CREATE TABLE agent_invites (
    token                TEXT    PRIMARY KEY,
    tenant_id            TEXT    NOT NULL REFERENCES tenants(id),
    inspector_contact_id TEXT,
    email                TEXT    NOT NULL,
    invited_by_user_id   TEXT    NOT NULL REFERENCES users(id),
    expires_at           INTEGER NOT NULL,
    accepted_at          INTEGER,
    created_at           INTEGER NOT NULL
);

CREATE INDEX idx_agent_invites_email      ON agent_invites(email);
CREATE INDEX idx_agent_invites_tenant     ON agent_invites(tenant_id);
CREATE INDEX idx_agent_invites_expiration ON agent_invites(expires_at);
