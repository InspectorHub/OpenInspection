/**
 * What the booking page OFFERS and what the arbitration ACCEPTS must be one rule.
 *
 * The grid used to judge a candidate slot only as [s, s + interval), while the
 * arbitration judged the booking over its full stamped length (the booked services,
 * or the default window), so a slot could be offered and then refused 409 - the same
 * slot, every retry. The grid now judges every candidate over the length the booking
 * will have (`windowMin`), so for every slot it offers, booking that slot wins. The
 * customer sees correspondingly fewer slots around existing inspections and time off.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import { BookingService } from '../../../server/services/booking.service';
import { tenants, users, inspections, inspectionInspectors, inspectionRequests, calendarBlocks, availabilityOverrides } from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { buildTenantSlotMap, type SlotOverrideRow, type SlotBlockRow, type SlotBusyRow } from '../../../server/lib/booking/tenant-slot-map';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = 'aaaaaaaa-0000-0000-0000-0000000000b3';
const DAY = '2027-03-09';
const INSPECTOR = 'insp-1';
const WINDOW = { inspectorId: INSPECTOR, startTime: '08:00', endTime: '17:00' };
const GRID = { intervalMin: 30 as const };
const T0 = new Date('2027-03-01T00:00:00Z');
const T1 = new Date('2027-03-01T00:00:01Z');

describe('every offered slot is a slot the arbitration accepts', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];
    let svc: BookingService;
    let n = 0;

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(db);
        svc = new BookingService({} as D1Database);
        await db.insert(tenants).values({ id: TENANT, slug: 'ov3', tier: 'free', status: 'active', maxUsers: 5, deploymentMode: 'shared', createdAt: new Date() } as never);
        await db.insert(users).values({ id: INSPECTOR, tenantId: TENANT, email: 'i@x.test', passwordHash: 'h', role: 'inspector', name: 'Solo', createdAt: new Date() });
    });
    afterEach(() => sqlite.close());

    const existing = async (time: string, durationMin: number | null) => {
        const id = `ex-${++n}`;
        const iso = `${DAY}T${time}:00Z`;
        await db.insert(inspectionRequests).values({ id: `req-${id}`, tenantId: TENANT, clientName: 'C', propertyAddress: '1 St', scheduledAt: new Date(iso), status: 'pending', createdAt: T0, updatedAt: T0 });
        await db.insert(inspections).values({ id, tenantId: TENANT, inspectorId: INSPECTOR, propertyAddress: '1 St', date: iso, status: 'requested', paymentStatus: 'unpaid', price: 0, requestId: `req-${id}`, createdAt: T0, durationMin } as never);
        await db.insert(inspectionInspectors).values({ inspectionId: id, userId: INSPECTOR, tenantId: TENANT, role: 'lead', createdAt: T0 });
        return { userId: INSPECTOR, date: iso, durationMin };
    };
    const block = async (startTime: string, endTime: string) => {
        await db.insert(calendarBlocks).values({ id: `blk-${++n}`, tenantId: TENANT, userId: INSPECTOR, title: 'Off', date: DAY, allDay: false, startTime, endTime, createdAt: new Date(), updatedAt: new Date() } as never);
        return { userId: INSPECTOR, allDay: false, startTime, endTime };
    };
    const override = async (o: { isAvailable: boolean; startTime?: string; endTime?: string; source?: 'google' }) => {
        await db.insert(availabilityOverrides).values({ id: `ov-${++n}`, tenantId: TENANT, inspectorId: INSPECTOR, date: DAY, isAvailable: o.isAvailable, startTime: o.startTime ?? null, endTime: o.endTime ?? null, createdAt: new Date(), ...(o.source ? { source: o.source, externalId: `e${n}` } : {}) } as never);
        return { inspectorId: INSPECTOR, isAvailable: o.isAvailable, startTime: o.startTime ?? null, endTime: o.endTime ?? null, source: o.source ?? null } as SlotOverrideRow;
    };

    /** Book every offered slot (one at a time, on a clean copy of the day) and expect the arbitration to accept it. */
    async function expectEveryOfferedSlotWins(opts: { windowMin: number; busy?: SlotBusyRow[]; blocks?: SlotBlockRow[]; overrides?: SlotOverrideRow[]; label: string }) {
        const map = buildTenantSlotMap([INSPECTOR], [WINDOW], opts.overrides ?? [], opts.busy ?? [], opts.blocks ?? [], GRID, opts.windowMin);
        const offered = [...map.entries()].filter(([, ids]) => ids.has(INSPECTOR)).map(([t]) => t).sort();
        expect(offered.length, `${opts.label}: the day should still offer something`).toBeGreaterThan(0);
        for (const time of offered) {
            const iso = `${DAY}T${time}:00Z`;
            const id = `mine-${time}`;
            await db.insert(inspectionRequests).values({ id: `req-${id}`, tenantId: TENANT, clientName: 'C', propertyAddress: '1 St', scheduledAt: new Date(iso), status: 'pending', createdAt: T1, updatedAt: T1 });
            await db.insert(inspections).values({ id, tenantId: TENANT, inspectorId: INSPECTOR, propertyAddress: '1 St', date: iso, status: 'requested', paymentStatus: 'unpaid', price: 0, requestId: `req-${id}`, createdAt: T1, durationMin: opts.windowMin } as never);
            await db.insert(inspectionInspectors).values({ inspectionId: id, userId: INSPECTOR, tenantId: TENANT, role: 'lead', createdAt: T1 });
            const verdict = await svc.arbitrateSlotRace(TENANT, INSPECTOR, DAY, time, `req-${id}`);
            expect(verdict, `${opts.label}: ${time} was offered but the arbitration refused it`).toBe('win');
            await svc.revokeBooking(TENANT, `req-${id}`);
        }
        return offered;
    }

    it('a 3-hour service next to an existing 11:00-13:00 inspection: 09:00 is NOT offered, and everything offered wins', async () => {
        const busy = [await existing('11:00', 120)];
        const offered = await expectEveryOfferedSlotWins({ windowMin: 180, busy, label: 'existing 11:00' });
        expect(offered).not.toContain('09:00');
        expect(offered).toContain('08:00');
        expect(offered).toContain('13:00');
    });

    it('no service chosen (the 180-minute default window) behaves the same', async () => {
        const busy = [await existing('11:00', 120)];
        await expectEveryOfferedSlotWins({ windowMin: 180, busy, label: 'default window' });
    });

    it('a calendar block 12:00-13:00 with a 3-hour booking: 09:30 is not offered (it would run into the block), 09:00 is (it ends as the block starts), everything offered wins', async () => {
        const blocks = [await block('12:00', '13:00')];
        const offered = await expectEveryOfferedSlotWins({ windowMin: 180, blocks, label: 'block 12-13' });
        expect(offered).not.toContain('09:30');
        expect(offered).toContain('09:00');
        expect(offered).toContain('08:00');
    });

    it('a synced busy event 12:00-13:00 is judged the same way', async () => {
        const overrides = [await override({ isAvailable: false, startTime: '12:00', endTime: '13:00', source: 'google' })];
        const offered = await expectEveryOfferedSlotWins({ windowMin: 180, overrides, label: 'synced busy' });
        expect(offered).not.toContain('10:30');
    });

    it('a manual block with extra hours 09:00-11:00 offers the starts inside them, and each of those wins', async () => {
        const overrides = [await override({ isAvailable: false }), await override({ isAvailable: true, startTime: '09:00', endTime: '11:00' })];
        const offered = await expectEveryOfferedSlotWins({ windowMin: 180, overrides, label: 'extra hours' });
        expect(offered).toEqual(['09:00', '09:30', '10:00', '10:30']);
    });

    it('a shorter service keeps more slots than a longer one (the window length is the whole difference)', async () => {
        const busy = [await existing('11:00', 120)];
        const slotsFor = (w: number) => [...buildTenantSlotMap([INSPECTOR], [WINDOW], [], busy, [], GRID, w).entries()].filter(([, ids]) => ids.has(INSPECTOR)).map(([t]) => t);
        expect(slotsFor(60).length).toBeGreaterThan(slotsFor(180).length);
        expect(slotsFor(60)).toContain('10:00');
    });

    it('rows with no recorded duration keep the start-time rule (control)', async () => {
        const busy = [await existing('11:00', null)];
        const offered = await expectEveryOfferedSlotWins({ windowMin: 180, busy, label: 'unrecorded' });
        expect(offered).toContain('10:00');
        expect(offered).not.toContain('11:00');
    });
});
