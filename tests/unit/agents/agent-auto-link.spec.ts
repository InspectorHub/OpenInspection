import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentService } from '../../../server/services/agent.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT_A = '00000000-0000-0000-0000-00000000000a';
const TENANT_B = '00000000-0000-0000-0000-00000000000b';
const TENANT_C = '00000000-0000-0000-0000-00000000000c';

describe('AgentService.autoLinkSameEmail', () => {
    let svc: AgentService;
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        await setupSchema(fixture.sqlite);

        await testDb.insert(schema.tenants).values([
            { id: TENANT_A, name: 'A', slug: 'aco', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
            { id: TENANT_B, name: 'B', slug: 'bco', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
            { id: TENANT_C, name: 'C', slug: 'cco', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);

        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        svc = new AgentService({} as D1Database);
    });

    async function seedAgentUser(email: string): Promise<string> {
        const id = crypto.randomUUID();
        await testDb.insert(schema.users).values({
            id, tenantId: null, email, role: 'agent', name: 'Jane', createdAt: new Date(), passwordHash: 'h',
        });
        return id;
    }

    it('links the ACTIVE contact, never an archived one with the same email', async () => {
        // `contacts` allows one ACTIVE row per (tenant, email) but any number of
        // archived ones, while agent_tenant_links allows one row per (agent,
        // tenant). Without an archived filter the dead record could win the
        // link — and the duplicate insert for the live contact would then be
        // swallowed by the unique-index catch, leaving the agent linked to a
        // contact no inspection references and a dashboard that is empty for
        // no visible reason.
        await testDb.insert(schema.contacts).values([
            { id: 'cOld', tenantId: TENANT_A, type: 'agent', name: 'Jane', email: 'jane@realty.com', createdAt: new Date(1), archivedAt: new Date(2) },
            { id: 'cNew', tenantId: TENANT_A, type: 'agent', name: 'Jane', email: 'jane@realty.com', createdAt: new Date(3) },
        ]);
        const userId = await seedAgentUser('jane@realty.com');

        const created = await svc.autoLinkSameEmail(userId, 'jane@realty.com');
        expect(created).toBe(1);

        const links = await testDb.select().from(schema.agentTenantLinks).all();
        expect(links).toHaveLength(1);
        expect(links[0].inspectorContactId).toBe('cNew');
    });

    it('always sets inspectorContactId — the column is NOT NULL', async () => {
        // IA-103. This is the only writer of the table now that invite-accept
        // is gone, and it finds the link BY the contact, so a row with no
        // contact behind it cannot be constructed.
        await testDb.insert(schema.contacts).values([
            { id: 'cA', tenantId: TENANT_A, type: 'agent', name: 'Jane', email: 'jane@realty.com', createdAt: new Date() },
        ]);
        const userId = await seedAgentUser('jane@realty.com');
        await svc.autoLinkSameEmail(userId, 'jane@realty.com');

        const links = await testDb.select().from(schema.agentTenantLinks).all();
        expect(links).toHaveLength(1);
        expect(links[0].inspectorContactId).toBe('cA');
    });

    it('creates a link for every contacts row matching email + type=agent', async () => {
        await testDb.insert(schema.contacts).values([
            { id: 'cA', tenantId: TENANT_A, type: 'agent', name: 'Jane', email: 'jane@realty.com', createdAt: new Date() },
            { id: 'cB', tenantId: TENANT_B, type: 'agent', name: 'Jane', email: 'jane@realty.com', createdAt: new Date() },
        ]);
        const userId = await seedAgentUser('jane@realty.com');

        const created = await svc.autoLinkSameEmail(userId, 'jane@realty.com');
        expect(created).toBe(2);

        const links = await testDb.select().from(schema.agentTenantLinks).all();
        expect(links).toHaveLength(2);
        const tenantIds = links.map((l) => l.tenantId).sort();
        expect(tenantIds).toEqual([TENANT_A, TENANT_B].sort());
        for (const link of links) expect(link.status).toBe('active');
    });

    it('skips contacts with type=client (only agent contacts auto-link)', async () => {
        await testDb.insert(schema.contacts).values([
            { id: 'cA', tenantId: TENANT_A, type: 'agent', name: 'Jane', email: 'jane@realty.com', createdAt: new Date() },
            { id: 'cB', tenantId: TENANT_B, type: 'client', name: 'Jane (client)', email: 'jane@realty.com', createdAt: new Date() },
        ]);
        const userId = await seedAgentUser('jane@realty.com');

        const created = await svc.autoLinkSameEmail(userId, 'jane@realty.com');
        expect(created).toBe(1);

        const links = await testDb.select().from(schema.agentTenantLinks).all();
        expect(links).toHaveLength(1);
        expect(links[0]?.tenantId).toBe(TENANT_A);
    });

    it('is idempotent — second invocation creates 0 new links', async () => {
        await testDb.insert(schema.contacts).values({
            id: 'cA', tenantId: TENANT_A, type: 'agent', name: 'Jane', email: 'jane@realty.com', createdAt: new Date(),
        });
        const userId = await seedAgentUser('jane@realty.com');

        expect(await svc.autoLinkSameEmail(userId, 'jane@realty.com')).toBe(1);
        expect(await svc.autoLinkSameEmail(userId, 'jane@realty.com')).toBe(0);
        const links = await testDb.select().from(schema.agentTenantLinks).all();
        expect(links).toHaveLength(1);
    });

    it('returns 0 when no contacts match', async () => {
        await testDb.insert(schema.contacts).values({
            id: 'cA', tenantId: TENANT_A, type: 'agent', name: 'Other', email: 'other@x.com', createdAt: new Date(),
        });
        const userId = await seedAgentUser('jane@realty.com');
        expect(await svc.autoLinkSameEmail(userId, 'jane@realty.com')).toBe(0);
    });

    it('honors lower-cased email (matching the canonicalization in invite/signup)', async () => {
        await testDb.insert(schema.contacts).values({
            id: 'cA', tenantId: TENANT_A, type: 'agent', name: 'Jane', email: 'jane@realty.com', createdAt: new Date(),
        });
        const userId = await seedAgentUser('jane@realty.com');
        // Caller sends mixed case; service should normalize before match.
        expect(await svc.autoLinkSameEmail(userId, 'Jane@Realty.com')).toBe(1);
    });

    it('preserves the inspector_contact_id pointer on the link row', async () => {
        await testDb.insert(schema.contacts).values({
            id: 'cA', tenantId: TENANT_A, type: 'agent', name: 'Jane', email: 'jane@realty.com', createdAt: new Date(),
        });
        const userId = await seedAgentUser('jane@realty.com');
        await svc.autoLinkSameEmail(userId, 'jane@realty.com');

        const link = (await testDb.select().from(schema.agentTenantLinks).all())[0];
        expect(link?.inspectorContactId).toBe('cA');
        expect(link?.invitedByUserId).toBeNull();
    });

    it('creates links for THREE matching tenants when applicable', async () => {
        await testDb.insert(schema.contacts).values([
            { id: 'cA', tenantId: TENANT_A, type: 'agent', name: 'Jane', email: 'jane@realty.com', createdAt: new Date() },
            { id: 'cB', tenantId: TENANT_B, type: 'agent', name: 'Jane', email: 'jane@realty.com', createdAt: new Date() },
            { id: 'cC', tenantId: TENANT_C, type: 'agent', name: 'Jane', email: 'jane@realty.com', createdAt: new Date() },
        ]);
        const userId = await seedAgentUser('jane@realty.com');
        expect(await svc.autoLinkSameEmail(userId, 'jane@realty.com')).toBe(3);
    });
});
