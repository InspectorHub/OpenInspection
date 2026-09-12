import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import * as schema from '../../../server/lib/db/schema';
import {
    inspectionWallClock,
    listCalendarItems,
} from '../../../server/services/calendar-items.service';
import { createTestDb, setupSchema } from '../db';

vi.mock('drizzle-orm/d1', () => ({
    drizzle: vi.fn(),
}));

const TENANT = '00000000-0000-0000-0000-0000000000bb';
const INSPECTOR = 'user-inspector-placement';

/**
 * `inspections.date` carries a TIME for most rows, and the calendar feed used to
 * throw it away twice over: it copied the whole raw string into `civilDate`
 * (which the views look up as `YYYY-MM-DD`, so nothing matched any cell) and it
 * set `allDay: true` unconditionally (so the dispatch board had no hour to place
 * a card at). One column, two surfaces, two silent failures.
 *
 * These are placement assertions, not formatting ones: a wrong `civilDate` is
 * invisible in a payload and total in a grid.
 */
describe('inspections.date → calendar placement', () => {
    describe('inspectionWallClock (pure)', () => {
        it('treats a bare civil date as the whole answer — no time, all day', () => {
            expect(inspectionWallClock('2026-09-10')).toEqual({
                civilDate: '2026-09-10',
                startTime: null,
            });
        });

        it('splits the schedule endpoint\'s wall-clock form', () => {
            // PATCH /inspections/:id/schedule writes `${civilDate}T${hm}` where hm
            // is already the TENANT wall clock.
            expect(inspectionWallClock('2026-09-10T09:00')).toEqual({
                civilDate: '2026-09-10',
                startTime: '09:00',
            });
        });

        it('splits the full-ISO form every create path writes', () => {
            // booking fulfilment and the multi-service request path both store
            // `scheduledAt.toISOString()`. This is the shape that emptied the
            // calendar: `2026-09-09T16:49:20.805Z` is not a cell key.
            expect(inspectionWallClock('2026-09-09T16:49:20.805Z')).toEqual({
                civilDate: '2026-09-09',
                startTime: '16:49',
            });
        });

        it('refuses a malformed suffix rather than inventing an hour', () => {
            expect(inspectionWallClock('2026-09-10Tnoon').startTime).toBeNull();
            expect(inspectionWallClock('2026-09-10T9:00').startTime).toBeNull();
            expect(inspectionWallClock('').startTime).toBeNull();
        });

        it('never moves the civil day, on a DST boundary or anywhere else', () => {
            // US spring-forward is 2027-03-14. A pure string slice cannot shift a
            // day; this pins that no instant parsing creeps back in.
            expect(inspectionWallClock('2027-03-14T02:30').civilDate).toBe('2027-03-14');
            expect(inspectionWallClock('2027-03-14T23:30:00.000Z').civilDate).toBe('2027-03-14');
            expect(inspectionWallClock('2027-11-07T01:30').civilDate).toBe('2027-11-07');
        });
    });

    describe('listCalendarItems', () => {
        let testDb: BetterSQLite3Database<typeof schema>;

        beforeEach(async () => {
            const fixture = createTestDb();
            testDb = fixture.db;
            await setupSchema(fixture.sqlite);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (mockDrizzle as any).mockReturnValue(testDb);

            const now = new Date();
            await testDb.insert(schema.tenants).values({
                id: TENANT,
                slug: 'placement',
                status: 'active',
                deploymentMode: 'shared',
                tier: 'free',
                createdAt: now,
            });
            await testDb.insert(schema.users).values({
                id: INSPECTOR,
                tenantId: TENANT,
                email: 'placement@acme.com',
                passwordHash: 'hash',
                role: 'inspector',
                createdAt: now,
            });
        });

        async function seed(id: string, date: string) {
            await testDb.insert(schema.inspections).values({
                id,
                tenantId: TENANT,
                inspectorId: INSPECTOR,
                propertyAddress: `${id} Evergreen Terrace`,
                date,
                status: 'scheduled',
                paymentStatus: 'unpaid',
                price: 0,
                paymentRequired: false,
                agreementRequired: false,
                createdAt: new Date(),
            });
        }

        const list = (effectiveTz = 'UTC') => listCalendarItems({} as D1Database, TENANT, {
            start: '2026-09-01',
            end: '2026-09-30',
            userIds: [INSPECTOR],
            effectiveTz,
        });

        it('buckets a full-ISO inspection on the civil day a grid cell asks for', async () => {
            await seed('iso-row', '2026-09-10T09:00:00.000Z');
            const item = (await list()).find((i) => i.id === 'iso-row');
            // The grid looks cells up by civilDateOf(2026, 8, 10) === '2026-09-10'.
            // Anything else — the raw column value included — renders nowhere.
            expect(item?.civilDate).toBe('2026-09-10');
            expect(item?.allDay).toBe(false);
            expect(item?.startTime).toBe('09:00');
        });

        it('gives a wall-clock inspection its hour instead of the all-day strip', async () => {
            await seed('wall-row', '2026-09-05T14:30');
            const item = (await list()).find((i) => i.id === 'wall-row');
            expect(item?.civilDate).toBe('2026-09-05');
            expect(item?.allDay).toBe(false);
            expect(item?.startTime).toBe('14:30');
        });

        it('POSITIVE CONTROL — a bare date is still all-day, so the fix cannot pass by timing everything', async () => {
            await seed('bare-row', '2026-09-07');
            const item = (await list()).find((i) => i.id === 'bare-row');
            expect(item?.civilDate).toBe('2026-09-07');
            expect(item?.allDay).toBe(true);
            expect(item?.startTime).toBeUndefined();
            // An all-day item's instant is the civil day, not a midnight UTC stamp.
            expect(item?.start).toBe('2026-09-07');
        });

        it('POSITIVE CONTROL — the rows reach the feed at all', async () => {
            await seed('iso-row', '2026-09-10T09:00:00.000Z');
            await seed('bare-row', '2026-09-07');
            const ids = (await list()).filter((i) => i.kind === 'inspection').map((i) => i.id);
            // F61 was "the payload has them and the grid does not", so an empty
            // feed must never be able to satisfy the assertions above.
            expect(ids.sort()).toEqual(['bare-row', 'iso-row']);
        });

        it('does not move a DST-boundary inspection off its civil day or its hour', async () => {
            // 2027-03-14 02:30 America/New_York does not exist (clocks jump 02:00
            // → 03:00). The card must still be on 03-14 at the wall clock stored,
            // never rolled into 03-13 or 03-15.
            await testDb.insert(schema.inspections).values({
                id: 'dst-row',
                tenantId: TENANT,
                inspectorId: INSPECTOR,
                propertyAddress: 'DST Lane',
                date: '2027-03-14T02:30',
                status: 'scheduled',
                paymentStatus: 'unpaid',
                price: 0,
                paymentRequired: false,
                agreementRequired: false,
                createdAt: new Date(),
            });
            const items = await listCalendarItems({} as D1Database, TENANT, {
                start: '2027-03-01',
                end: '2027-03-31',
                userIds: [INSPECTOR],
                effectiveTz: 'America/New_York',
            });
            const item = items.find((i) => i.id === 'dst-row');
            expect(item?.civilDate).toBe('2027-03-14');
            expect(item?.startTime).toBe('02:30');
            expect(item?.allDay).toBe(false);
        });
    });
});
