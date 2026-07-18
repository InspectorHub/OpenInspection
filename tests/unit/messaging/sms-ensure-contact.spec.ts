/**
 * Task 9b (people-role-profiles) — ensureClientContact no longer reads
 * inspection.clientEmail/.clientName/.clientPhone off an inspection-shaped
 * argument (those legacy denormalized columns are being dropped, Task 13).
 * Signature changed to (dbRaw, tenantId, inspectionId): it now backfills
 * inspections.client_contact_id from the EXISTING contact referenced by the
 * inspection_people primary-client join (PeopleService.getPrimaryClient) —
 * there is no more dedupe-by-email/create-new-contact step, because a
 * primary-client join always already points at a real contacts row.
 *
 * Task 9c — the "already linked" fast path ALSO no longer reads the legacy
 * inspections.client_contact_id column directly; it now resolves the primary
 * client via PeopleService.contactIdForRole every time (inspection_people is
 * the sole source of truth) and (re)writes the resolved id onto the legacy
 * column purely as a backfill for the other, not-yet-converted readers of
 * that cache (automation, contact.service, ...).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { and, eq } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { ensureClientContact } from '../../../server/lib/sms/ensure-client-contact';

const TENANT = '00000000-0000-0000-0000-000000000001';
const CLIENT = 'contact-client-1';

const roleProfileId = (key: string) => `crp_${TENANT}_${key}`;

let db: BetterSQLite3Database<typeof schema>;
let sqlite: { close: () => void };

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db as BetterSQLite3Database<typeof schema>;
    sqlite = fx.sqlite;
    await setupSchema(fx.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    await db.insert(schema.tenants).values({
        id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    } as never);
    await seedRoleProfiles(db, TENANT, new Date(1));
    await db.insert(schema.contacts).values({
        id: CLIENT, tenantId: TENANT, type: 'client', name: 'Jane Client',
        email: 'jane@example.com', phone: '+15551234567', createdAt: new Date(),
    } as never);
});

afterEach(() => sqlite.close());

async function seedInspection(id: string, over: Partial<typeof schema.inspections.$inferInsert> = {}) {
    await db.insert(schema.inspections).values({
        id, tenantId: TENANT, propertyAddress: '1 Main',
        date: '2026-07-01', status: 'requested', paymentStatus: 'unpaid', price: 0,
        agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        ...over,
    } as never);
}

describe('ensureClientContact (Task 9b — primary-client join)', () => {
    it('already-linked (legacy column AND inspection_people agree) — returns the primary client contact id (Task 9c)', async () => {
        const id = crypto.randomUUID();
        const existingId = crypto.randomUUID();
        await db.insert(schema.contacts).values({
            id: existingId, tenantId: TENANT, type: 'client', name: 'Someone Else',
            email: 'someone@example.com', createdAt: new Date(),
        } as never);
        await seedInspection(id, { clientContactId: existingId });
        await db.insert(schema.inspectionPeople).values({
            id: `ip_${id}_client`, tenantId: TENANT, inspectionId: id,
            contactId: existingId, roleProfileId: roleProfileId('client'), createdAt: new Date(),
        } as never);

        const result = await ensureClientContact({} as D1Database, TENANT, id);
        expect(result).toBe(existingId);
    });

    it('stale legacy clientContactId, no inspection_people row — resolves via the join, not the stale column (Task 9c)', async () => {
        // Guards against a regression to reading inspections.client_contact_id
        // directly: a stale legacy value with no backing inspection_people row
        // must NOT be returned — inspection_people is the sole source of truth.
        const id = crypto.randomUUID();
        const staleId = crypto.randomUUID();
        await db.insert(schema.contacts).values({
            id: staleId, tenantId: TENANT, type: 'client', name: 'Stale Contact',
            email: 'stale@example.com', createdAt: new Date(),
        } as never);
        await seedInspection(id, { clientContactId: staleId });

        const result = await ensureClientContact({} as D1Database, TENANT, id);
        expect(result).toBeNull();
    });

    it('not yet linked, primary client present — backfills clientContactId from the inspection_people join', async () => {
        const id = crypto.randomUUID();
        await seedInspection(id, { clientContactId: null });
        await db.insert(schema.inspectionPeople).values({
            id: `ip_${id}_client`, tenantId: TENANT, inspectionId: id,
            contactId: CLIENT, roleProfileId: roleProfileId('client'), createdAt: new Date(),
        } as never);

        const result = await ensureClientContact({} as D1Database, TENANT, id);
        expect(result).toBe(CLIENT);

        const refreshed = await db.select().from(schema.inspections)
            .where(eq(schema.inspections.id, id)).get();
        expect(refreshed?.clientContactId).toBe(CLIENT);
    });

    it('two inspections sharing the same primary-client contact both resolve to that one contact (no duplicate created)', async () => {
        const id1 = crypto.randomUUID();
        const id2 = crypto.randomUUID();
        await seedInspection(id1, { clientContactId: null });
        await seedInspection(id2, { clientContactId: null });
        await db.insert(schema.inspectionPeople).values([
            { id: `ip_${id1}_client`, tenantId: TENANT, inspectionId: id1, contactId: CLIENT, roleProfileId: roleProfileId('client'), createdAt: new Date() },
            { id: `ip_${id2}_client`, tenantId: TENANT, inspectionId: id2, contactId: CLIENT, roleProfileId: roleProfileId('client'), createdAt: new Date() },
        ] as never);

        const c1 = await ensureClientContact({} as D1Database, TENANT, id1);
        const c2 = await ensureClientContact({} as D1Database, TENANT, id2);

        expect(c1).toBe(CLIENT);
        expect(c2).toBe(CLIENT);
        const clients = await db.select().from(schema.contacts)
            .where(and(eq(schema.contacts.tenantId, TENANT), eq(schema.contacts.id, CLIENT))).all();
        expect(clients.length).toBe(1);
    });

    it('no clientContactId and no primary client at all — null', async () => {
        const id = crypto.randomUUID();
        await seedInspection(id, { clientContactId: null });
        const result = await ensureClientContact({} as D1Database, TENANT, id);
        expect(result).toBeNull();
    });

    it('unknown inspection id — null (degenerate)', async () => {
        const result = await ensureClientContact({} as D1Database, TENANT, 'no-such-inspection');
        expect(result).toBeNull();
    });
});
