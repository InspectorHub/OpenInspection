import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as schema from '../../server/lib/db/schema';
import { createTestDb, setupSchema } from './db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { and, eq } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { ensureClientContact } from '../../server/lib/sms/ensure-client-contact';

const TENANT = '00000000-0000-0000-0000-000000000001';

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
});

afterEach(() => sqlite.close());

async function seedInspection(over: Partial<typeof schema.inspections.$inferInsert> = {}) {
    const id = crypto.randomUUID();
    await db.insert(schema.inspections).values({
        id, tenantId: TENANT, propertyAddress: '1 Main', clientName: 'Jane',
        clientEmail: 'jane@example.com', clientPhone: '(555) 123-4567',
        date: '2026-07-01', status: 'draft', paymentStatus: 'unpaid', price: 0,
        agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        ...over,
    } as never);
    return (await db.select().from(schema.inspections).where(eq(schema.inspections.id, id)).get())!;
}

describe('ensureClientContact (D6b)', () => {
    it('already-linked → returns the existing contact id, creates nothing', async () => {
        const existingId = crypto.randomUUID();
        await db.insert(schema.contacts).values({
            id: existingId, tenantId: TENANT, type: 'client', name: 'Jane',
            email: 'jane@example.com', createdAt: new Date(),
        } as never);
        const insp = await seedInspection({ clientContactId: existingId });

        const result = await ensureClientContact({} as D1Database, TENANT, insp);
        expect(result).toBe(existingId);
        const all = await db.select().from(schema.contacts).all();
        expect(all.length).toBe(1);
    });

    it('free-typed client with email → creates a contact + back-links inspection', async () => {
        const insp = await seedInspection({ clientContactId: null });
        const result = await ensureClientContact({} as D1Database, TENANT, insp);
        expect(result).toBeTruthy();

        const contact = await db.select().from(schema.contacts)
            .where(eq(schema.contacts.id, result!)).get();
        expect(contact?.email).toBe('jane@example.com');
        expect(contact?.name).toBe('Jane');

        const refreshed = await db.select().from(schema.inspections)
            .where(eq(schema.inspections.id, insp.id)).get();
        expect(refreshed?.clientContactId).toBe(result);
    });

    it('same email on a second inspection → dedupes to the same contact', async () => {
        const insp1 = await seedInspection({ clientContactId: null });
        const c1 = await ensureClientContact({} as D1Database, TENANT, insp1);

        const insp2 = await seedInspection({ clientContactId: null, clientName: 'Jane (rebook)' });
        const c2 = await ensureClientContact({} as D1Database, TENANT, insp2);

        expect(c2).toBe(c1);
        const clients = await db.select().from(schema.contacts)
            .where(and(eq(schema.contacts.tenantId, TENANT), eq(schema.contacts.email, 'jane@example.com'))).all();
        expect(clients.length).toBe(1);
    });

    it('no contact and no client data at all → null', async () => {
        const insp = await seedInspection({
            clientContactId: null, clientName: null, clientEmail: null, clientPhone: null,
        });
        const result = await ensureClientContact({} as D1Database, TENANT, insp);
        expect(result).toBeNull();
    });
});
