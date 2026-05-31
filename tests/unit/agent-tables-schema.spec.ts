import { describe, it, expect, beforeEach } from 'vitest';
import { agentTenantLinks, agentInvites } from '../../server/lib/db/schema/tenant';
import { createTestDb, setupSchema } from './db';

describe('agent tables schema — A1', () => {
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

    it('agent_invites Drizzle declaration exposes the spec columns', () => {
        const t = agentInvites as unknown as Record<string, { name: string }>;
        expect(t.token.name).toBe('token');
        expect(t.email.name).toBe('email');
        expect(t.expiresAt.name).toBe('expires_at');
        expect(t.acceptedAt.name).toBe('accepted_at');
    });

    it('agent_tenant_links table accepts a row + enforces unique (agent_user_id, tenant_id)', () => {
        // Seed a tenant + user so the FK references resolve.
        sqlite.prepare(`INSERT INTO tenants (id, name, subdomain, tier, status, max_users, deployment_mode, created_at) VALUES (?,?,?,?,?,?,?,?)`).run(
            't1', 'Acme', 'acme', 'free', 'active', 5, 'shared', Date.now(),
        );
        sqlite.prepare(`INSERT INTO users (id, tenant_id, email, password_hash, role, created_at) VALUES (?, NULL, ?, ?, 'agent', ?)`).run(
            'agent1', 'jane@realty.com', 'h', Date.now(),
        );

        const insert = sqlite.prepare(
            `INSERT INTO agent_tenant_links (id, agent_user_id, tenant_id, status, created_at) VALUES (?,?,?,?,?)`,
        );
        insert.run('link1', 'agent1', 't1', 'active', Date.now());
        expect(() => insert.run('link2', 'agent1', 't1', 'active', Date.now())).toThrow(/UNIQUE constraint/);
    });

    it('agent_invites table accepts a row + status CHECK rejects invalid value via agent_tenant_links CHECK constraint', () => {
        sqlite.prepare(`INSERT INTO tenants (id, name, subdomain, tier, status, max_users, deployment_mode, created_at) VALUES (?,?,?,?,?,?,?,?)`).run(
            't1', 'Acme', 'acme', 'free', 'active', 5, 'shared', Date.now(),
        );
        sqlite.prepare(`INSERT INTO users (id, tenant_id, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, 'inspector', ?)`).run(
            'inspector1', 't1', 'mike@a.com', 'h', Date.now(),
        );

        const insert = sqlite.prepare(
            `INSERT INTO agent_invites (token, tenant_id, email, invited_by_user_id, expires_at, created_at) VALUES (?,?,?,?,?,?)`,
        );
        expect(() => insert.run('tok-abc', 't1', 'jane@realty.com', 'inspector1', Date.now() + 86400000, Date.now())).not.toThrow();

        // Status CHECK on agent_tenant_links rejects invalid values
        const badInsert = sqlite.prepare(
            `INSERT INTO agent_tenant_links (id, agent_user_id, tenant_id, status, created_at) VALUES (?,?,?,?,?)`,
        );
        sqlite.prepare(`INSERT INTO users (id, tenant_id, email, password_hash, role, created_at) VALUES (?, NULL, ?, ?, 'agent', ?)`).run(
            'agent2', 'jane2@realty.com', 'h', Date.now(),
        );
        expect(() => badInsert.run('linkX', 'agent2', 't1', 'bogus-status', Date.now())).toThrow(/CHECK constraint/);
    });
});
