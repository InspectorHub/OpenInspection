/**
 * Task 9b (people-role-profiles) — ensureClientContact no longer reads
 * inspection.clientEmail/.clientName/.clientPhone off an inspection-shaped
 * argument (those legacy denormalized columns were dropped in Task 13).
 * Signature is (dbRaw, tenantId, inspectionId): it resolves the primary
 * client contact id via the inspection_people join (PeopleService.
 * contactIdForRole) — there is no more dedupe-by-email/create-new-contact
 * step, because a primary-client join always already points at a real
 * contacts row.
 *
 * Task 13 — the function is now a PURE resolve. It no longer back-links
 * inspections.client_contact_id (that column, and every other legacy
 * denormalized client column, is gone); inspection_people is the sole
 * source of truth with no cache to keep in sync.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

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

describe('ensureClientContact (Task 9b — primary-client join; Task 13 — pure resolve, no legacy columns)', () => {
    it('primary client present — resolves the contact id via inspection_people', async () => {
        const id = crypto.randomUUID();
        await seedInspection(id);
        await db.insert(schema.inspectionPeople).values({
            id: `ip_${id}_client`, tenantId: TENANT, inspectionId: id,
            contactId: CLIENT, roleProfileId: roleProfileId('client'), createdAt: new Date(),
        } as never);

        const result = await ensureClientContact({} as D1Database, TENANT, id);
        expect(result).toBe(CLIENT);
    });

    it('two inspections sharing the same primary-client contact both resolve to that one contact', async () => {
        const id1 = crypto.randomUUID();
        const id2 = crypto.randomUUID();
        await seedInspection(id1);
        await seedInspection(id2);
        await db.insert(schema.inspectionPeople).values([
            { id: `ip_${id1}_client`, tenantId: TENANT, inspectionId: id1, contactId: CLIENT, roleProfileId: roleProfileId('client'), createdAt: new Date() },
            { id: `ip_${id2}_client`, tenantId: TENANT, inspectionId: id2, contactId: CLIENT, roleProfileId: roleProfileId('client'), createdAt: new Date() },
        ] as never);

        const c1 = await ensureClientContact({} as D1Database, TENANT, id1);
        const c2 = await ensureClientContact({} as D1Database, TENANT, id2);

        expect(c1).toBe(CLIENT);
        expect(c2).toBe(CLIENT);
    });

    it('no primary client at all — null', async () => {
        const id = crypto.randomUUID();
        await seedInspection(id);
        const result = await ensureClientContact({} as D1Database, TENANT, id);
        expect(result).toBeNull();
    });

    it('unknown inspection id — null (degenerate)', async () => {
        const result = await ensureClientContact({} as D1Database, TENANT, 'no-such-inspection');
        expect(result).toBeNull();
    });
});
