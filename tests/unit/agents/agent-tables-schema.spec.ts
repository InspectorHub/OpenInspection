/**
 * The agent data model, asserted at the schema level.
 *
 * Both tables this file used to cover are gone. An agent is now just a contact
 * that happens to carry an account binding — the two side tables existed to
 * express a relationship the contact row could hold itself:
 *
 *   - `agent_invites` (D2): an invitation to someone who could already read
 *     everything without being invited.
 *   - `agent_tenant_links` (IA-104): a join row pointing at a contact in a
 *     tenant it already knew, whose pointer was written once and never
 *     updated — so contact churn silently stranded it.
 *
 * The absence assertions below are deliberate. Each table's non-existence is a
 * precondition something else now depends on, and a precondition worth
 * depending on is worth failing a build over.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { contacts } from '../../../server/lib/db/schema/contact';
import { createTestDb, setupSchema } from '../db';

describe('agent schema', () => {
    let sqlite: import('better-sqlite3').Database;

    beforeEach(async () => {
        const fixture = createTestDb();
        sqlite = fixture.sqlite;
        await setupSchema(fixture.sqlite);
    });

    it('carries the account binding on contacts', () => {
        const t = contacts as unknown as Record<string, { name: string }>;
        expect(t.agentUserId.name).toBe('agent_user_id');
        expect(t.agentLinkedAt.name).toBe('agent_linked_at');
        expect(t.agentRevokedAt.name).toBe('agent_revoked_at');
    });

    it('allows only one LIVE contact per tenant to hold a given agent account', () => {
        sqlite.prepare(`INSERT INTO tenants (id, name, slug, tier, status, max_users, deployment_mode, created_at) VALUES (?,?,?,?,?,?,?,?)`).run(
            't1', 'Acme', 'acme', 'free', 'active', 5, 'shared', Date.now(),
        );
        const insert = sqlite.prepare(
            `INSERT INTO contacts (id, tenant_id, type, name, email, created_at, agent_user_id, agent_linked_at) VALUES (?,?,'agent',?,?,?,?,?)`,
        );
        insert.run('c1', 't1', 'Jane', 'jane@realty.com', Date.now(), 'agent1', Date.now());
        expect(() =>
            insert.run('c2', 't1', 'Jane again', 'jane2@realty.com', Date.now(), 'agent1', Date.now()),
        ).toThrow(/UNIQUE constraint/);
    });

    it('frees the slot when the holding contact is archived', () => {
        // This is the whole reason the index is partial. The old
        // agent_tenant_links unique constraint was unconditional, so a tenant
        // that archived an agent contact and re-added the same person could
        // never bind the new row — the dead one still held the slot, and every
        // inspection on the live contact fell out of that agent's view.
        sqlite.prepare(`INSERT INTO tenants (id, name, slug, tier, status, max_users, deployment_mode, created_at) VALUES (?,?,?,?,?,?,?,?)`).run(
            't1', 'Acme', 'acme', 'free', 'active', 5, 'shared', Date.now(),
        );
        sqlite.prepare(
            `INSERT INTO contacts (id, tenant_id, type, name, email, created_at, agent_user_id, agent_linked_at, archived_at) VALUES (?,?,'agent',?,?,?,?,?,?)`,
        ).run('cOld', 't1', 'Jane', 'jane@realty.com', Date.now(), 'agent1', Date.now(), Date.now());

        expect(() =>
            sqlite.prepare(
                `INSERT INTO contacts (id, tenant_id, type, name, email, created_at, agent_user_id, agent_linked_at) VALUES (?,?,'agent',?,?,?,?,?)`,
            ).run('cNew', 't1', 'Jane', 'jane2@realty.com', Date.now(), 'agent1', Date.now()),
        ).not.toThrow();
    });

    it('agent_invites is gone', () => {
        const row = sqlite
            .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='agent_invites'`)
            .get();
        expect(row).toBeUndefined();
    });

    it('agent_tenant_links is gone', () => {
        const row = sqlite
            .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='agent_tenant_links'`)
            .get();
        expect(row).toBeUndefined();
    });
});
