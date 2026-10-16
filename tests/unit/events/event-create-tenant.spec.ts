/**
 * A visit is created under an inspection named in the URL. The inspection has to be one of the
 * caller's own company: otherwise a visit could be hung on another company's inspection, or on an
 * id that does not exist, and show up on the calendar as an orphan.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { EventService } from '../../../server/services/event.service';
import { createTestDb, setupSchema } from '../db';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const T_OWN = '00000000-0000-0000-0000-0000000000a1';
const T_OTHER = '00000000-0000-0000-0000-0000000000b2';
let BODY: { eventTypeId: string; scheduledAt: Date; durationMin: number };

let db: BetterSQLite3Database<typeof schema>;

async function seedInspection(id: string, tenantId: string) {
    await db.insert(schema.inspections).values({
        id, tenantId, propertyAddress: '1 Main', date: '2026-11-01', status: 'scheduled',
        paymentStatus: 'unpaid', price: 0, createdAt: new Date(),
    } as never);
}

describe('creating a visit', () => {
    beforeEach(async () => {
        const t = createTestDb();
        await setupSchema(t.sqlite);
        db = t.db;
        vi.mocked(mockDrizzle).mockReturnValue(db as never);
        for (const [id, slug] of [[T_OWN, 'own'], [T_OTHER, 'other']] as const) {
            await db.insert(schema.tenants).values({
                id, slug, tier: 'free', status: 'active', maxUsers: 10, deploymentMode: 'shared', createdAt: new Date(),
            } as never);
        }
        const type = await new EventService({} as D1Database).createEventType(T_OWN, { name: 'Radon test', slug: 'radon-test' });
        BODY = { eventTypeId: type.id, scheduledAt: new Date('2026-11-03T14:00:00.000Z'), durationMin: 60 };
        await seedInspection('own-1', T_OWN);
        await seedInspection('other-1', T_OTHER);
    });

    const svc = () => new EventService({} as D1Database);

    it('works for an inspection of the caller\'s own company (control)', async () => {
        const row = await svc().createEvent(T_OWN, 'own-1', BODY);
        expect(row.inspectionId).toBe('own-1');
        expect(await db.select().from(schema.inspectionEvents)).toHaveLength(1);
    });

    it('refuses another company\'s inspection and writes nothing', async () => {
        await expect(svc().createEvent(T_OWN, 'other-1', BODY)).rejects.toMatchObject({ status: 404 });
        expect(await db.select().from(schema.inspectionEvents)).toHaveLength(0);
    });

    it('refuses an inspection id that does not exist and writes nothing', async () => {
        await expect(svc().createEvent(T_OWN, 'no-such-inspection', BODY)).rejects.toMatchObject({ status: 404 });
        expect(await db.select().from(schema.inspectionEvents)).toHaveLength(0);
    });
});
