import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentService } from '../../../server/services/agent.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { EmailService } from '../../../server/services/email.service';
import { eq } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const T1 = '00000000-0000-0000-0000-000000000001';
const T2 = '00000000-0000-0000-0000-000000000002';
const AGENT_USER = '00000000-0000-0000-0000-000000000a01';
const OTHER_AGENT_USER = '00000000-0000-0000-0000-000000000a02';
const INSPECTOR_T1 = '00000000-0000-0000-0000-00000000ab01';
const INSPECTOR_T2 = '00000000-0000-0000-0000-00000000ab02';

describe('AgentService.listReferrals — A2', () => {
    let svc: AgentService;
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        await setupSchema(fixture.sqlite);

        await testDb.insert(schema.tenants).values([
            { id: T1, name: 'Acme Inspections', slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
            { id: T2, name: 'BobsInsp', slug: 'bobs', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);

        await testDb.insert(schema.users).values([
            { id: AGENT_USER, tenantId: null, email: 'jane@realty.com', role: 'agent', name: 'Jane', createdAt: new Date(), passwordHash: 'h' },
            { id: OTHER_AGENT_USER, tenantId: null, email: 'other@realty.com', role: 'agent', name: 'Other', createdAt: new Date(), passwordHash: 'h' },
            { id: INSPECTOR_T1, tenantId: T1, email: 'mike@acme.com', role: 'inspector', name: 'Mike', createdAt: new Date(), passwordHash: 'h' },
            { id: INSPECTOR_T2, tenantId: T2, email: 'bob@bobs.com', role: 'inspector', name: 'Bob', createdAt: new Date(), passwordHash: 'h' },
        ]);

        // Two agent contact rows in T1 + T2 representing Jane (one per tenant).
        // contact-IDs become referredByAgentId on inspections so the query can
        // resolve agent ownership.
        await testDb.insert(schema.contacts).values([
            { id: 'jane-c1', tenantId: T1, type: 'agent', name: 'Jane', email: 'jane@realty.com', createdAt: new Date() },
            { id: 'jane-c2', tenantId: T2, type: 'agent', name: 'Jane', email: 'jane@realty.com', createdAt: new Date() },
            { id: 'other-c1', tenantId: T1, type: 'agent', name: 'Other', email: 'other@realty.com', createdAt: new Date() },
        ]);

        await testDb.insert(schema.agentTenantLinks).values([
            { id: 'l1', agentUserId: AGENT_USER, tenantId: T1, inspectorContactId: 'jane-c1', status: 'active', createdAt: new Date() },
            { id: 'l2', agentUserId: AGENT_USER, tenantId: T2, inspectorContactId: 'jane-c2', status: 'active', createdAt: new Date() },
            { id: 'l3', agentUserId: OTHER_AGENT_USER, tenantId: T1, inspectorContactId: 'other-c1', status: 'active', createdAt: new Date() },
        ]);

        await testDb.insert(schema.inspections).values([
            { id: 'i-1', tenantId: T1, inspectorId: INSPECTOR_T1, propertyAddress: '1 Main', clientName: 'Sarah', date: '2026-06-01', status: 'confirmed', paymentStatus: 'paid', referredByAgentId: 'jane-c1', price: 0, createdAt: new Date() },
            { id: 'i-2', tenantId: T1, inspectorId: INSPECTOR_T1, propertyAddress: '2 Oak', clientName: 'Bob', date: '2026-06-02', status: 'completed', reportStatus: 'published', paymentStatus: 'paid', referredByAgentId: 'jane-c1', price: 0, createdAt: new Date() },
            { id: 'i-3', tenantId: T2, inspectorId: INSPECTOR_T2, propertyAddress: '3 Elm', clientName: 'Tim', date: '2026-06-03', status: 'requested', paymentStatus: 'unpaid', referredByAgentId: 'jane-c2', price: 0, createdAt: new Date() },
            { id: 'other-agent-inspection', tenantId: T1, inspectorId: INSPECTOR_T1, propertyAddress: '99 Pine', clientName: 'Dan', date: '2026-06-04', status: 'requested', paymentStatus: 'unpaid', referredByAgentId: 'other-c1', price: 0, createdAt: new Date() },
            { id: 'no-referral-inspection', tenantId: T1, inspectorId: INSPECTOR_T1, propertyAddress: '11 Pine', clientName: 'Eve', date: '2026-06-05', status: 'requested', paymentStatus: 'unpaid', referredByAgentId: null, price: 0, createdAt: new Date() },
        ]);

        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        const stubEmail: Pick<EmailService, 'sendAgentInvite'> = {
            sendAgentInvite: vi.fn().mockResolvedValue(undefined),
        };
        svc = new AgentService(
            {} as D1Database,
            stubEmail as unknown as EmailService,
            'https://acme.example.com',
        );
    });

    it('returns inspections from all tenants the agent has active links with', async () => {
        const refs = await svc.listReferrals(AGENT_USER, { limit: 50 });
        expect(refs.length).toBe(3);
        const tenantIds = refs.map((r) => r.tenantId).sort();
        expect(tenantIds).toEqual([T1, T1, T2].sort());
    });

    it('does not leak inspections from other agents within the same tenants', async () => {
        const refs = await svc.listReferrals(AGENT_USER, { limit: 50 });
        expect(refs.find((r) => r.id === 'other-agent-inspection')).toBeUndefined();
        expect(refs.find((r) => r.id === 'no-referral-inspection')).toBeUndefined();
    });

    it('respects status="revoked" — agent loses access after revoke', async () => {
        await testDb.update(schema.agentTenantLinks)
            .set({ status: 'revoked' })
            .where(eq(schema.agentTenantLinks.id, 'l1'));
        const refs = await svc.listReferrals(AGENT_USER, { limit: 50 });
        expect(refs.find((r) => r.tenantId === T1)).toBeUndefined();
        expect(refs.length).toBe(1);
        expect(refs[0]?.tenantId).toBe(T2);
    });

    it('exposes tenantName, address, status, paymentStatus on each row', async () => {
        const refs = await svc.listReferrals(AGENT_USER, { limit: 50 });
        const r1 = refs.find((r) => r.id === 'i-1');
        expect(r1).toBeDefined();
        expect(r1?.tenantName).toBe('Acme Inspections');
        expect(r1?.propertyAddress).toBe('1 Main');
        expect(r1?.clientName).toBe('Sarah');
        expect(r1?.status).toBe('confirmed');
        expect(r1?.paymentStatus).toBe('paid');
    });

    it('respects opts.limit', async () => {
        const refs = await svc.listReferrals(AGENT_USER, { limit: 1 });
        expect(refs.length).toBe(1);
    });
});

describe('AgentService.listInspectors — A2', () => {
    let svc: AgentService;
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        await setupSchema(fixture.sqlite);

        await testDb.insert(schema.tenants).values([
            { id: T1, name: 'Acme Inspections', slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
            { id: T2, name: 'BobsInsp', slug: 'bobs', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);

        await testDb.insert(schema.users).values([
            { id: AGENT_USER, tenantId: null, email: 'jane@realty.com', role: 'agent', name: 'Jane', createdAt: new Date(), passwordHash: 'h' },
            { id: INSPECTOR_T1, tenantId: T1, email: 'mike@acme.com', role: 'inspector', name: 'Mike', slug: 'mike', photoUrl: 'https://r2/me.jpg', createdAt: new Date(), passwordHash: 'h' },
            { id: INSPECTOR_T2, tenantId: T2, email: 'bob@bobs.com', role: 'inspector', name: 'Bob', slug: 'bob', createdAt: new Date(), passwordHash: 'h' },
        ]);

        await testDb.insert(schema.contacts).values([
            { id: 'jane-c1', tenantId: T1, type: 'agent', name: 'Jane', email: 'jane@realty.com', createdByUserId: INSPECTOR_T1, createdAt: new Date() },
            { id: 'jane-c2', tenantId: T2, type: 'agent', name: 'Jane', email: 'jane@realty.com', createdByUserId: INSPECTOR_T2, createdAt: new Date() },
        ]);

        await testDb.insert(schema.agentTenantLinks).values([
            { id: 'l1', agentUserId: AGENT_USER, tenantId: T1, inspectorContactId: 'jane-c1', invitedByUserId: INSPECTOR_T1, status: 'active', createdAt: new Date() },
            { id: 'l2', agentUserId: AGENT_USER, tenantId: T2, inspectorContactId: 'jane-c2', invitedByUserId: INSPECTOR_T2, status: 'active', createdAt: new Date() },
        ]);

        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        const stubEmail: Pick<EmailService, 'sendAgentInvite'> = {
            sendAgentInvite: vi.fn().mockResolvedValue(undefined),
        };
        svc = new AgentService(
            {} as D1Database,
            stubEmail as unknown as EmailService,
            'https://acme.example.com',
        );
    });

    it('returns one row per active link with inspector contact info', async () => {
        const rows = await svc.listInspectors(AGENT_USER);
        expect(rows.length).toBe(2);
        const tenantNames = rows.map((r) => r.tenantName).sort();
        expect(tenantNames).toEqual(['Acme Inspections', 'BobsInsp']);
    });

    it('omits revoked links', async () => {
        await testDb.update(schema.agentTenantLinks)
            .set({ status: 'revoked' })
            .where(eq(schema.agentTenantLinks.id, 'l1'));
        const rows = await svc.listInspectors(AGENT_USER);
        expect(rows.length).toBe(1);
        expect(rows[0]?.tenantId).toBe(T2);
    });

    it('exposes inspector slug + photo + name + tenant slug', async () => {
        const rows = await svc.listInspectors(AGENT_USER);
        const acme = rows.find((r) => r.tenantId === T1);
        expect(acme?.inspectorSlug).toBe('mike');
        expect(acme?.inspectorPhotoUrl).toBe('https://r2/me.jpg');
        expect(acme?.inspectorName).toBe('Mike');
        expect(acme?.tenantSlug).toBe('acme');
    });

    it('falls back to null inspector fields when invitedByUserId missing', async () => {
        // Add a link with no invitedByUserId (auto-link path).
        await testDb.insert(schema.tenants).values({
            id: 'T3', name: 'NoInspector', slug: 'no', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await testDb.insert(schema.agentTenantLinks).values({
            id: 'l3', agentUserId: AGENT_USER, tenantId: 'T3', status: 'active', createdAt: new Date(),
        });
        const rows = await svc.listInspectors(AGENT_USER);
        const noRow = rows.find((r) => r.tenantId === 'T3');
        expect(noRow).toBeDefined();
        expect(noRow?.inspectorName).toBeNull();
        expect(noRow?.inspectorSlug).toBeNull();
    });
});

describe('AgentService.revokeLink — A2', () => {
    let svc: AgentService;
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        await setupSchema(fixture.sqlite);

        await testDb.insert(schema.tenants).values({
            id: T1, name: 'Acme', slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await testDb.insert(schema.users).values({
            id: AGENT_USER, tenantId: null, email: 'jane@realty.com', role: 'agent', name: 'Jane', createdAt: new Date(), passwordHash: 'h',
        });
        await testDb.insert(schema.agentTenantLinks).values({
            id: 'l1', agentUserId: AGENT_USER, tenantId: T1, status: 'active', createdAt: new Date(),
        });

        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        const stubEmail: Pick<EmailService, 'sendAgentInvite'> = {
            sendAgentInvite: vi.fn().mockResolvedValue(undefined),
        };
        svc = new AgentService(
            {} as D1Database,
            stubEmail as unknown as EmailService,
            'https://acme.example.com',
        );
    });

    it('flips link status to revoked + sets revokedAt', async () => {
        await svc.revokeLink('l1', T1);
        const row = await testDb.select().from(schema.agentTenantLinks)
            .where(eq(schema.agentTenantLinks.id, 'l1')).get();
        expect(row?.status).toBe('revoked');
        expect(row?.revokedAt).toBeTruthy();
    });

    it('rejects revoke when link belongs to a different tenant', async () => {
        await expect(svc.revokeLink('l1', 'wrong-tenant')).rejects.toThrow();
        const row = await testDb.select().from(schema.agentTenantLinks)
            .where(eq(schema.agentTenantLinks.id, 'l1')).get();
        expect(row?.status).toBe('active');
    });
});

describe('AgentService.updateProfile — A2', () => {
    let svc: AgentService;
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        await setupSchema(fixture.sqlite);

        await testDb.insert(schema.users).values({
            id: AGENT_USER, tenantId: null, email: 'jane@realty.com', role: 'agent', name: 'Jane', createdAt: new Date(), passwordHash: 'h',
        });

        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        const stubEmail: Pick<EmailService, 'sendAgentInvite'> = {
            sendAgentInvite: vi.fn().mockResolvedValue(undefined),
        };
        svc = new AgentService(
            {} as D1Database,
            stubEmail as unknown as EmailService,
            'https://acme.example.com',
        );
    });

    it('persists slug + notification prefs', async () => {
        await svc.updateProfile(AGENT_USER, {
            slug: 'jane',
            notifyOnReferral: true,
            notifyOnReport: false,
            notifyOnPaid: true,
        });
        const row = await testDb.select().from(schema.users)
            .where(eq(schema.users.id, AGENT_USER)).get();
        expect(row?.slug).toBe('jane');
        expect(row?.notifyOnReferral).toBe(true);
        expect(row?.notifyOnReport).toBe(false);
        expect(row?.notifyOnPaid).toBe(true);
    });

    it('rejects slug taken by another global agent user', async () => {
        await testDb.insert(schema.users).values({
            id: 'other-agent', tenantId: null, email: 'x@x.com', role: 'agent', name: 'X', slug: 'jane', createdAt: new Date(), passwordHash: 'h',
        });
        await expect(svc.updateProfile(AGENT_USER, { slug: 'jane' })).rejects.toThrow();
    });

    it('does not write fields that were not provided', async () => {
        await svc.updateProfile(AGENT_USER, { slug: 'jane' });
        await svc.updateProfile(AGENT_USER, { notifyOnPaid: true });
        const row = await testDb.select().from(schema.users)
            .where(eq(schema.users.id, AGENT_USER)).get();
        expect(row?.slug).toBe('jane');
        expect(row?.notifyOnPaid).toBe(true);
    });
});
