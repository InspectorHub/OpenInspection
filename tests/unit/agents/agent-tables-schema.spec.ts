import { describe, it, expect, beforeEach } from 'vitest';
import { agentTenantLinks } from '../../../server/lib/db/schema/tenant';
import { createTestDb, setupSchema } from '../db';

describe('agent tables schema', () => {
    let sqlite: import('better-sqlite3').Database;

    beforeEach(async () => {
        const fixture = createTestDb();
        sqlite = fixture.sqlite;
        await setupSchema(sqlite);
    });

    it('agent_tenant_links Drizzle declaration exposes the spec columns', () => {
        const t = agentTenantLinks as unknown as Record<string, { name: string }>;
        expect(t.agentUserId.name).toBe('agent_user_id');
        expect(t.tenantId.name).toBe('tenant_id');
        expect(t.status.name).toBe('status');
        expect(t.inspectorContactId.name).toBe('inspector_contact_id');
    });

    it('agent_tenant_links table accepts a row + enforces unique (agent_user_id, tenant_id)', () => {
        // Seed a tenant + user so the FK references resolve.
        sqlite.prepare(`INSERT INTO tenants (id, name, slug, tier, status, max_users, deployment_mode, created_at) VALUES (?,?,?,?,?,?,?,?)`).run(
            't1', 'Acme', 'acme', 'free', 'active', 5, 'shared', Date.now(),
        );
        sqlite.prepare(`INSERT INTO users (id, tenant_id, email, password_hash, role, created_at) VALUES (?, NULL, ?, ?, 'agent', ?)`).run(
            'agent1', 'jane@realty.com', 'h', Date.now(),
        );

        const insert = sqlite.prepare(
            `INSERT INTO agent_tenant_links (id, agent_user_id, tenant_id, inspector_contact_id, status, created_at) VALUES (?,?,?,?,?,?)`,
        );
        insert.run('link1', 'agent1', 't1', 'c1', 'active', Date.now());
        expect(() => insert.run('link2', 'agent1', 't1', 'c1', 'active', Date.now())).toThrow(/UNIQUE constraint/);
    });

    it('agent_tenant_links enforces the tenant_id FK', () => {
        sqlite.prepare(`INSERT INTO tenants (id, name, slug, tier, status, max_users, deployment_mode, created_at) VALUES (?,?,?,?,?,?,?,?)`).run(
            't1', 'Acme', 'acme', 'free', 'active', 5, 'shared', Date.now(),
        );

        // The `status` enum (pending | active | revoked) is enforced at the
        // application layer (Zod: server/api/agents.ts) — the DB schema carries
        // no CHECK constraint (this codebase uses none), so a bogus status is
        // accepted by SQLite. The DB-level invariant we *can* assert here is the
        // tenant_id FK: linking to a non-existent tenant must be rejected.
        sqlite.prepare(`INSERT INTO users (id, tenant_id, email, password_hash, role, created_at) VALUES (?, NULL, ?, ?, 'agent', ?)`).run(
            'agent2', 'jane2@realty.com', 'h', Date.now(),
        );

        // FK enforcement is off by default in SQLite; enable it for this check.
        sqlite.pragma('foreign_keys = ON');
        const badInsert = sqlite.prepare(
            `INSERT INTO agent_tenant_links (id, agent_user_id, tenant_id, inspector_contact_id, status, created_at) VALUES (?,?,?,?,?,?)`,
        );
        expect(() => badInsert.run('linkX', 'agent2', 'no-such-tenant', 'c1', 'active', Date.now())).toThrow(/FOREIGN KEY constraint/);
    });

    it('agent_invites is gone', () => {
        // The invite track was removed: an agent reads a report through a
        // per-inspection token that needs no account, so an invitation gated
        // nothing. Asserted here because the table's absence is the thing that
        // makes agent_tenant_links.inspector_contact_id safe to require —
        // invite-accept was the only path that could create a link with no
        // contact behind it.
        const row = sqlite
            .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='agent_invites'`)
            .get();
        expect(row).toBeUndefined();
    });
});
