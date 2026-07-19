/**
 * Spec 2 Task 2a — `trigger()`'s enqueue loop fans out via `resolveRecipients`
 * instead of the single-address `resolveAddress`, so a multi-recipient rule
 * (role→agent, or `recipientKind:'all'`) enqueues ONE `automation_logs` row
 * PER recipient, each stamped with that recipient's `recipient_role_key`.
 * This is enqueue-only: delivery (`delivery.ts` flush) is untouched.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { AutomationService } from '../../../server/services/automation.service';
import { PeopleService } from '../../../server/services/people.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';

const TENANT = '00000000-0000-0000-0000-00000000fa20';
const roleProfileId = (key: string) => `crp_${TENANT}_${key}`;

let db: BetterSQLite3Database<typeof schema>;
let svc: AutomationService;

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db;
    await setupSchema(fx.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    await db.insert(schema.tenants).values({
        id: TENANT, name: 'Acme', slug: 'acme-fa20', status: 'active', phone: '+15550009999',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    } as never);
    await seedRoleProfiles(db, TENANT, new Date(1));
    svc = new AutomationService({} as D1Database);
    vi.spyOn(svc, 'ensureSeeds').mockResolvedValue();
});

async function seedInspection(id: string, over: Partial<typeof schema.inspections.$inferInsert> = {}) {
    await db.insert(schema.inspections).values({
        id, tenantId: TENANT, propertyAddress: '1 Main',
        date: '2026-07-01', status: 'completed', reportStatus: 'published',
        paymentStatus: 'unpaid', price: 0, agreementRequired: false, paymentRequired: false,
        createdAt: new Date(), ...over,
    } as never);
}

async function addContact(id: string, fields: { name: string; email?: string | null; phone?: string | null; type?: 'client' | 'agent' }) {
    await db.insert(schema.contacts).values({
        id, tenantId: TENANT, type: fields.type ?? 'client', name: fields.name,
        email: fields.email ?? null, phone: fields.phone ?? null, createdAt: new Date(),
    } as never);
}

const people = () => new PeopleService({ DB: {} as D1Database });

async function logsFor(automationId: string, inspectionId: string) {
    return (await db.select().from(schema.automationLogs)
        .where(eq(schema.automationLogs.inspectionId, inspectionId)).all())
        .filter((l) => l.automationId === automationId);
}

describe('AutomationService.trigger — per-recipient fan-out (Spec 2 Task 2a)', () => {
    it("recipientKind:'role'→buyer_agent enqueues exactly ONE email log with recipient_role_key='buyer_agent'", async () => {
        const insp = 'insp-fanout-role-single';
        await seedInspection(insp);
        await addContact('c-buyer-1', { name: "Buyer's Agent", email: 'buyer-agent@example.com', type: 'agent' });
        await people().addPerson(TENANT, insp, 'c-buyer-1', roleProfileId('buyer_agent'));
        const created = await svc.create(TENANT, {
            name: 'R-buyer-agent', trigger: 'report.published', recipientKind: 'role',
            recipientRoleProfileId: roleProfileId('buyer_agent'), delayMinutes: 0,
            channels: ['email'],
        });
        await svc.trigger({ tenantId: TENANT, inspectionId: insp, triggerEvent: 'report.published',
            companyName: 'Acme', reportBaseUrl: 'https://acme.example.com' });
        const logs = await logsFor(created.id, insp);
        expect(logs).toHaveLength(1);
        expect(logs[0].channel).toBe('email');
        expect(logs[0].recipient).toBe('buyer-agent@example.com');
        expect(logs[0].recipientRoleKey).toBe('buyer_agent');
    });

    it("recipientKind:'all' with 2 people who both have email enqueues 2 email logs, each with the right recipient_role_key", async () => {
        const insp = 'insp-fanout-all';
        await seedInspection(insp);
        await addContact('c-client-2', { name: 'Jane Client', email: 'jane@example.com' });
        await addContact('c-listing-2', { name: 'Listing Agent', email: 'listing-agent@example.com', type: 'agent' });
        await people().addPerson(TENANT, insp, 'c-client-2', roleProfileId('client'));
        await people().addPerson(TENANT, insp, 'c-listing-2', roleProfileId('listing_agent'));
        const created = await svc.create(TENANT, {
            name: 'R-all', trigger: 'report.published', recipientKind: 'all',
            recipientRoleProfileId: null, delayMinutes: 0,
            channels: ['email'],
        });
        await svc.trigger({ tenantId: TENANT, inspectionId: insp, triggerEvent: 'report.published',
            companyName: 'Acme', reportBaseUrl: 'https://acme.example.com' });
        const logs = await logsFor(created.id, insp);
        expect(logs).toHaveLength(2);
        const byRole = Object.fromEntries(logs.map((l) => [l.recipientRoleKey, l.recipient]));
        expect(byRole.client).toBe('jane@example.com');
        expect(byRole.listing_agent).toBe('listing-agent@example.com');
    });

    it('email-channel widening: a buyer_agent rule now produces an email log (the old "email->client only" gap is gone on the enqueue path)', async () => {
        const insp = 'insp-fanout-widening';
        await seedInspection(insp);
        await addContact('c-buyer-3', { name: "Buyer's Agent", email: 'widened-agent@example.com', type: 'agent' });
        await people().addPerson(TENANT, insp, 'c-buyer-3', roleProfileId('buyer_agent'));
        const created = await svc.create(TENANT, {
            name: 'R-widen', trigger: 'report.published', recipientKind: 'role',
            recipientRoleProfileId: roleProfileId('buyer_agent'), delayMinutes: 0,
            channels: ['email'],
        });
        await svc.trigger({ tenantId: TENANT, inspectionId: insp, triggerEvent: 'report.published',
            companyName: 'Acme', reportBaseUrl: 'https://acme.example.com' });
        const logs = await logsFor(created.id, insp);
        // Previously resolveAddress gated email to the PRIMARY_CLIENT_KEY profile
        // only, so a buyer_agent rule's email channel yielded zero logs. Now it
        // must yield exactly one, via resolveRecipients.
        expect(logs).toHaveLength(1);
        expect(logs[0].recipient).toBe('widened-agent@example.com');
    });

    it("recipientKind:'role' pointing at the client profile still enqueues exactly ONE log (unchanged for existing client rules)", async () => {
        const insp = 'insp-fanout-client-unchanged';
        await seedInspection(insp);
        await addContact('c-client-3', { name: 'Jane Client', email: 'jane-unchanged@example.com' });
        await people().addPerson(TENANT, insp, 'c-client-3', roleProfileId('client'));
        const created = await svc.create(TENANT, {
            name: 'R-client', trigger: 'report.published', recipientKind: 'role',
            recipientRoleProfileId: roleProfileId('client'), delayMinutes: 0,
            channels: ['email'],
        });
        await svc.trigger({ tenantId: TENANT, inspectionId: insp, triggerEvent: 'report.published',
            companyName: 'Acme', reportBaseUrl: 'https://acme.example.com' });
        const logs = await logsFor(created.id, insp);
        expect(logs).toHaveLength(1);
        expect(logs[0].recipientRoleKey).toBe('client');
    });

    it("recipientKind:'inspector' enqueues one log with recipient_role_key='inspector'", async () => {
        const insp = 'insp-fanout-inspector';
        await db.insert(schema.users).values({
            id: 'u-inspector-fanout', tenantId: TENANT, email: 'inspector@example.com',
            name: 'Inspector', role: 'inspector', passwordHash: 'x', createdAt: new Date(),
        } as never);
        await seedInspection(insp, { inspectorId: 'u-inspector-fanout' } as never);
        const created = await svc.create(TENANT, {
            name: 'R-inspector', trigger: 'report.published', recipientKind: 'inspector',
            recipientRoleProfileId: null, delayMinutes: 0,
            channels: ['email'],
        });
        await svc.trigger({ tenantId: TENANT, inspectionId: insp, triggerEvent: 'report.published',
            companyName: 'Acme', reportBaseUrl: 'https://acme.example.com' });
        const logs = await logsFor(created.id, insp);
        expect(logs).toHaveLength(1);
        expect(logs[0].recipientRoleKey).toBe('inspector');
        expect(logs[0].recipient).toBe('inspector@example.com');
    });
});
