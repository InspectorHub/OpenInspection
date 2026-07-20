/**
 * Spec 2 Task 1 — `resolveRecipients` returns EVERY matching recipient for a
 * rule (role / all / inspector), unlike `resolveAddress` which only ever
 * targets the single primary-client address. This is a pure additive
 * resolver: production delivery (the trigger flush loop, `resolveAddress`)
 * is untouched — a later task wires this into the send loop.
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

const TENANT = '00000000-0000-0000-0000-00000000ab1a';
const roleProfileId = (key: string) => `crp_${TENANT}_${key}`;

let db: BetterSQLite3Database<typeof schema>;
let svc: AutomationService;

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db;
    await setupSchema(fx.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    await db.insert(schema.tenants).values({
        id: TENANT, name: 'Acme', slug: 'acme-ab1a', status: 'active', phone: '+15550009999',
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

async function inspRowOf(id: string) {
    const row = await db.select().from(schema.inspections).where(eq(schema.inspections.id, id)).get();
    if (!row) throw new Error('inspection not seeded');
    return row;
}

describe('AutomationService.resolveRecipients', () => {
    it("recipientKind:'role' resolves the buyer_agent's contactId + email (email channel)", async () => {
        const insp = 'insp-role-buyer-agent';
        await seedInspection(insp);
        await addContact('c-buyer-1', { name: "Buyer's Agent", email: 'buyer-agent@example.com', type: 'agent' });
        await people().addPerson(TENANT, insp, 'c-buyer-1', roleProfileId('buyer_agent'));

        const result = await svc.resolveRecipients(
            { recipientKind: 'role', recipientRoleProfileId: roleProfileId('buyer_agent') },
            await inspRowOf(insp), 'email',
        );

        expect(result).toEqual([
            { contactId: 'c-buyer-1', roleKey: 'buyer_agent', email: 'buyer-agent@example.com' },
        ]);
    });

    it("recipientKind:'all' returns every receivesReport person, skipping an email-less person (no throw)", async () => {
        const insp = 'insp-all-kind';
        await seedInspection(insp);
        await addContact('c-client-1', { name: 'Jane Client', email: 'jane@example.com', phone: '+15551110000' });
        await addContact('c-buyer-1', { name: "Buyer's Agent", email: 'buyer-agent@example.com', type: 'agent' });
        // Listing agent has NO email — must be skipped, not thrown.
        await addContact('c-listing-1', { name: 'Listing Agent', email: null, phone: '+15552220000', type: 'agent' });
        await people().addPerson(TENANT, insp, 'c-client-1', roleProfileId('client'));
        await people().addPerson(TENANT, insp, 'c-buyer-1', roleProfileId('buyer_agent'));
        await people().addPerson(TENANT, insp, 'c-listing-1', roleProfileId('listing_agent'));

        const result = await svc.resolveRecipients(
            { recipientKind: 'all', recipientRoleProfileId: null },
            await inspRowOf(insp), 'email',
        );

        expect(result.slice().sort((a, b) => a.contactId.localeCompare(b.contactId))).toEqual([
            { contactId: 'c-buyer-1', roleKey: 'buyer_agent', email: 'buyer-agent@example.com' },
            { contactId: 'c-client-1', roleKey: 'client', email: 'jane@example.com' },
        ]);
        expect(result.some(r => r.contactId === 'c-listing-1')).toBe(false);
    });

    it("recipientKind:'inspector' resolves the assigned inspector's user id + email", async () => {
        const insp = 'insp-inspector';
        await db.insert(schema.users).values({
            id: 'u-inspector-1', tenantId: TENANT, email: 'inspector@example.com', phone: '+15559998888',
            passwordHash: 'hash', role: 'inspector', createdAt: new Date(),
        } as never);
        await seedInspection(insp, { inspectorId: 'u-inspector-1' } as never);

        const result = await svc.resolveRecipients(
            { recipientKind: 'inspector', recipientRoleProfileId: null },
            await inspRowOf(insp), 'email',
        );

        expect(result).toEqual([
            { contactId: 'u-inspector-1', roleKey: 'inspector', email: 'inspector@example.com' },
        ]);
    });

    it("recipientKind:'inspector' returns an empty array when the inspector has no email (sms channel requested, no phone either checked separately)", async () => {
        const insp = 'insp-inspector-none';
        await seedInspection(insp); // no inspectorId set at all

        const result = await svc.resolveRecipients(
            { recipientKind: 'inspector', recipientRoleProfileId: null },
            await inspRowOf(insp), 'email',
        );

        expect(result).toEqual([]);
    });
});
