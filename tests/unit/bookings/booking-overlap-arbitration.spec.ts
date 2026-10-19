/**
 * Double-booking, beyond "the same start time".
 *
 * Findings that shaped this (see the commit message):
 *   - an inspection stores its start in `inspections.date` (a naive wall-clock ISO
 *     string) and, once stamped, a duration; the link table has no time at all;
 *   - the busy check and the post-insert arbitration compared only the HH:MM of the
 *     START, so a booking at 10:00 inside a recorded 09:00-12:00 inspection was
 *     offered and accepted;
 *   - time off added between the availability read and the insert was never looked at
 *     again.
 * A database unique index could not express "same inspector, same start" because
 * the sibling inspections of one multi-service booking share both.
 *
 * Recorded durations are honoured when BOTH sides carry one; a row without one
 * (legacy, or not yet stamped) keeps the old start-time rule, so nothing changes
 * for data that has no duration.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import { BookingService } from '../../../server/services/booking.service';
import { tenants, users, inspections, inspectionInspectors, inspectionRequests, calendarBlocks, availabilityOverrides } from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { buildTenantSlotMap } from '../../../server/lib/booking/tenant-slot-map';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = 'aaaaaaaa-0000-0000-0000-0000000000b2';
const DAY = '2027-03-09';
const T0 = new Date('2027-03-01T00:00:00Z');
const T1 = new Date('2027-03-01T00:00:01Z');

describe('slot map honours recorded durations', () => {
    const INSPECTOR = 'insp-1';
    const GRID = { intervalMin: 60 as const };
    const WINDOW = { inspectorId: INSPECTOR, startTime: '08:00', endTime: '14:00' };
    const free = (busy: Array<{ userId: string; date: string; durationMin?: number | null }>) =>
        [...buildTenantSlotMap([INSPECTOR], [WINDOW], [], busy, [], GRID).entries()].filter(([, ids]) => ids.has(INSPECTOR)).map(([t]) => t).sort();

    it('a 3-hour inspection at 09:00 takes 09:00, 10:00 and 11:00', () => {
        expect(free([{ userId: INSPECTOR, date: `${DAY}T09:00:00Z`, durationMin: 180 }])).toEqual(['08:00', '12:00', '13:00']);
    });

    it('a row with no recorded duration keeps the start-time rule (control)', () => {
        expect(free([{ userId: INSPECTOR, date: `${DAY}T09:00:00Z`, durationMin: null }])).toEqual(['08:00', '10:00', '11:00', '12:00', '13:00']);
    });

    it('an inspection ending exactly when a slot starts leaves that slot free', () => {
        expect(free([{ userId: INSPECTOR, date: `${DAY}T09:00:00Z`, durationMin: 60 }])).toContain('10:00');
    });
});

describe('arbitrateSlotRace with durations and time off', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];
    let svc: BookingService;

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(db);
        svc = new BookingService({} as D1Database);
        await db.insert(tenants).values({ id: TENANT, slug: 'ov', tier: 'free', status: 'active', maxUsers: 5, deploymentMode: 'shared', createdAt: new Date() } as never);
        await db.insert(users).values({ id: 'insp-1', tenantId: TENANT, email: 'i@x.test', passwordHash: 'h', role: 'inspector', name: 'Solo', createdAt: new Date() });
    });
    afterEach(() => sqlite.close());

    async function seed(opts: { id: string; requestId: string | null; createdAt: Date; time: string; durationMin?: number | null; status?: string }) {
        const dateIso = `${DAY}T${opts.time}:00Z`;
        if (opts.requestId) {
            await db.insert(inspectionRequests).values({ id: opts.requestId, tenantId: TENANT, clientName: 'C', propertyAddress: '1 St', scheduledAt: new Date(dateIso), status: 'pending', createdAt: opts.createdAt, updatedAt: opts.createdAt }).onConflictDoNothing();
        }
        await db.insert(inspections).values({
            id: opts.id, tenantId: TENANT, inspectorId: 'insp-1', propertyAddress: '1 St', date: dateIso, status: (opts.status ?? 'requested') as never,
            paymentStatus: 'unpaid', price: 0, requestId: opts.requestId, createdAt: opts.createdAt, durationMin: opts.durationMin ?? null,
        } as never);
        await db.insert(inspectionInspectors).values({ inspectionId: opts.id, userId: 'insp-1', tenantId: TENANT, role: 'lead', createdAt: opts.createdAt });
    }
    const arbitrate = (time: string, req = 'req-mine') => svc.arbitrateSlotRace(TENANT, 'insp-1', DAY, time, req);

    it('loses to an earlier booking whose recorded window covers my start (10:00 inside 09:00-12:00)', async () => {
        await seed({ id: 'rival', requestId: 'req-rival', createdAt: T0, time: '09:00', durationMin: 180 });
        await seed({ id: 'mine', requestId: 'req-mine', createdAt: T1, time: '10:00', durationMin: 60 });
        expect(await arbitrate('10:00')).toBe('lose');
    });

    it('and the earlier one wins against the later, from its own side', async () => {
        await seed({ id: 'rival', requestId: 'req-rival', createdAt: T0, time: '09:00', durationMin: 180 });
        await seed({ id: 'mine', requestId: 'req-mine', createdAt: T1, time: '10:00', durationMin: 60 });
        expect(await arbitrate('09:00', 'req-rival')).toBe('win');
    });

    it('back-to-back windows do not collide: 09:00-10:00 then 10:00-11:00', async () => {
        await seed({ id: 'rival', requestId: 'req-rival', createdAt: T0, time: '09:00', durationMin: 60 });
        await seed({ id: 'mine', requestId: 'req-mine', createdAt: T1, time: '10:00', durationMin: 60 });
        expect(await arbitrate('10:00')).toBe('win');
    });

    it('without recorded durations only the same start collides (the old rule, unchanged)', async () => {
        await seed({ id: 'rival', requestId: 'req-rival', createdAt: T0, time: '09:00' });
        await seed({ id: 'mine', requestId: 'req-mine', createdAt: T1, time: '10:00' });
        expect(await arbitrate('10:00')).toBe('win');
    });

    it('a cancelled rival never collides', async () => {
        await seed({ id: 'rival', requestId: 'req-rival', createdAt: T0, time: '09:00', durationMin: 180, status: 'cancelled' });
        await seed({ id: 'mine', requestId: 'req-mine', createdAt: T1, time: '10:00', durationMin: 60 });
        expect(await arbitrate('10:00')).toBe('win');
    });

    it('sibling inspections of my own booking never collide with each other', async () => {
        await seed({ id: 'mine-a', requestId: 'req-mine', createdAt: T1, time: '10:00', durationMin: 120 });
        await seed({ id: 'mine-b', requestId: 'req-mine', createdAt: T1, time: '10:00', durationMin: 120 });
        expect(await arbitrate('10:00')).toBe('win');
    });

    describe('time off added after the availability read', () => {
        const mine = () => seed({ id: 'mine', requestId: 'req-mine', createdAt: T1, time: '10:00', durationMin: 60 });
        const block = (over: Partial<typeof calendarBlocks.$inferInsert>) => db.insert(calendarBlocks).values({
            id: 'blk', tenantId: TENANT, userId: 'insp-1', title: 'Off', date: DAY, allDay: false, startTime: '10:30', endTime: '11:30', createdAt: new Date(), updatedAt: new Date(), ...over,
        } as never);
        const override = (over: Partial<typeof availabilityOverrides.$inferInsert>) => db.insert(availabilityOverrides).values({
            id: 'ov', tenantId: TENANT, inspectorId: 'insp-1', date: DAY, isAvailable: false, createdAt: new Date(), ...over,
        } as never);

        it('loses when a timed calendar block now overlaps the booking', async () => {
            await mine(); await block({});
            expect(await arbitrate('10:00')).toBe('lose');
        });

        it('wins when the block ends as the booking starts', async () => {
            await mine(); await block({ startTime: '09:00', endTime: '10:00' });
            expect(await arbitrate('10:00')).toBe('win');
        });

        it('loses to an all-day block', async () => {
            await mine(); await block({ allDay: true, startTime: null, endTime: null });
            expect(await arbitrate('10:00')).toBe('lose');
        });

        it('loses to a manual blocking override for the day', async () => {
            await mine(); await override({});
            expect(await arbitrate('10:00')).toBe('lose');
        });

        it('a manual block with extra hours covering the slot still wins (the slot map keeps those hours)', async () => {
            await mine(); await override({}); await override({ id: 'ov2', isAvailable: true, startTime: '09:00', endTime: '12:00' });
            expect(await arbitrate('10:00')).toBe('win');
        });

        it('loses to a synced busy event that overlaps, wins against one that does not, and ignores free (transparent) events', async () => {
            await mine();
            await override({ id: 'far', source: 'google', externalId: 'e1', startTime: '14:00', endTime: '15:00' });
            await override({ id: 'free', source: 'google', externalId: 'e2', startTime: '10:00', endTime: '11:00', transparency: 'transparent' });
            expect(await arbitrate('10:00')).toBe('win');
            await override({ id: 'near', source: 'google', externalId: 'e3', startTime: '10:30', endTime: '11:00' });
            expect(await arbitrate('10:00')).toBe('lose');
        });

        it('another inspector\'s time off is irrelevant', async () => {
            await mine();
            await db.insert(users).values({ id: 'insp-2', tenantId: TENANT, email: 'j@x.test', passwordHash: 'h', role: 'inspector', name: 'Other', createdAt: new Date() });
            await block({ userId: 'insp-2', allDay: true, startTime: null, endTime: null });
            expect(await arbitrate('10:00')).toBe('win');
        });
    });
});
