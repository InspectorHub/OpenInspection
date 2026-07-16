import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import { BookingService } from '../../../server/services/booking.service';
import {
    tenants,
    users,
    services,
    availability,
    calendarBlocks,
    serviceInspectors,
} from '../../../server/lib/db/schema';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

/** 2026-06-08 is a Monday (dayOfWeek = 1). */
const MONDAY = '2026-06-08';

describe('getTenantSlots calendar_blocks busy', () => {
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
            role: 'inspector', name: 'u1', createdAt: new Date(),
        });
        await db.insert(services).values({
            id: 's1', tenantId: 't1', name: 'Residential', price: 40000, createdAt: new Date(),
        });
        await db.insert(serviceInspectors).values({
            serviceId: 's1', userId: 'u1', tenantId: 't1', createdAt: new Date(),
        });
        await db.insert(availability).values({
            id: 'a1', tenantId: 't1', inspectorId: 'u1', dayOfWeek: 1,
            startTime: '08:00', endTime: '10:00', createdAt: new Date(),
        });
    });

    afterEach(() => sqlite.close());

    it('all-day calendar_block removes all slots for the inspector (like a blocking override)', async () => {
        const now = new Date();
        await db.insert(calendarBlocks).values({
            id: 'cb-allday',
            tenantId: 't1',
            userId: 'u1',
            title: 'PTO',
            date: MONDAY,
            startTime: null,
            endTime: null,
            allDay: true,
            notes: null,
            createdAt: now,
            updatedAt: now,
        });

        const { slots } = await svc.getTenantSlots('t1', MONDAY, ['s1']);
        expect(slots).toEqual([]);
    });

    it('timed calendar_block marks overlapping slots unavailable', async () => {
        const now = new Date();
        await db.insert(calendarBlocks).values({
            id: 'cb-timed',
            tenantId: 't1',
            userId: 'u1',
            title: 'Doctor',
            date: MONDAY,
            startTime: '09:00',
            endTime: '10:00',
            allDay: false,
            notes: null,
            createdAt: now,
            updatedAt: now,
        });

        const { slots } = await svc.getTenantSlots('t1', MONDAY, ['s1']);
        const at = (time: string) => slots.find((s) => s.time === time)!;

        expect(at('08:00').available).toBe(true);
        expect(at('08:00').inspectorIds).toEqual(['u1']);
        expect(at('08:30').available).toBe(true);

        expect(at('09:00').available).toBe(false);
        expect(at('09:00').inspectorIds).toEqual([]);
        expect(at('09:30').available).toBe(false);
        expect(at('09:30').inspectorIds).toEqual([]);
    });
});
