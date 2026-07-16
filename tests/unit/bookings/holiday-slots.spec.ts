import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import { BookingService } from '../../../server/services/booking.service';
import {
    tenants,
    users,
    services,
    availability,
    tenantConfigs,
} from '../../../server/lib/db/schema';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

/** Thanksgiving 2026 is a Thursday (dayOfWeek = 4). */
const THANKSGIVING = '2026-11-26';

describe('getTenantSlots holiday policies', () => {
    let svc: BookingService;
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as ReturnType<typeof vi.fn>).mockReturnValue(db);
        svc = new BookingService({} as D1Database);

        await db.insert(tenants).values({ id: 't1', name: 'Acme', slug: 'acme', createdAt: new Date() });
        await db.insert(users).values({
            id: 'u1', tenantId: 't1', email: 'u1@x.com', passwordHash: 'h',
            role: 'owner', name: 'u1', createdAt: new Date(),
        });
        await db.insert(services).values({
            id: 's1', tenantId: 't1', name: 'Residential', price: 40000, createdAt: new Date(),
        });
        await db.insert(availability).values({
            id: 'a1', tenantId: 't1', inspectorId: 'u1', dayOfWeek: 4,
            startTime: '08:00', endTime: '10:00', createdAt: new Date(),
        });
        await db.insert(tenantConfigs).values({
            tenantId: 't1',
            updatedAt: new Date(),
            holidayRegion: 'US',
            holidayPublicPolicy: 'block',
            holidayInternalPolicy: 'advisory',
        });
    });

    afterEach(() => sqlite.close());

    it('block returns no slots on a catalog holiday', async () => {
        const { slots, holidayAdvisory } = await svc.getTenantSlots('t1', THANKSGIVING, []);
        expect(slots).toEqual([]);
        expect(holidayAdvisory).toBeUndefined();
    });

    it('advisory keeps slots and attaches holidayAdvisory', async () => {
        await db.update(tenantConfigs).set({ holidayPublicPolicy: 'advisory' });
        const { slots, holidayAdvisory } = await svc.getTenantSlots('t1', THANKSGIVING, []);
        expect(slots.length).toBeGreaterThan(0);
        expect(slots.some((s) => s.available)).toBe(true);
        expect(holidayAdvisory).toEqual({ date: THANKSGIVING, name: 'Thanksgiving Day' });
    });

    it('open ignores catalog and returns normal slots', async () => {
        await db.update(tenantConfigs).set({ holidayPublicPolicy: 'open' });
        const { slots, holidayAdvisory } = await svc.getTenantSlots('t1', THANKSGIVING, []);
        expect(slots.length).toBeGreaterThan(0);
        expect(holidayAdvisory).toBeUndefined();
    });

    it('null region is a no-op even on Thanksgiving', async () => {
        await db.update(tenantConfigs).set({
            holidayRegion: null,
            holidayPublicPolicy: 'block',
        });
        const { slots } = await svc.getTenantSlots('t1', THANKSGIVING, []);
        expect(slots.length).toBeGreaterThan(0);
    });
});
