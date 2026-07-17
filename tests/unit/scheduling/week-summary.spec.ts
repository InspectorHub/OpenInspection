import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import * as schema from '../../../server/lib/db/schema';
import weekSummaryRoutes from '../../../server/api/schedule-week-summary';
import { BookingService } from '../../../server/services/booking.service';
import type { HonoConfig } from '../../../server/types/hono';
import { createTestDb, setupSchema } from '../db';

vi.mock('drizzle-orm/d1', () => ({
    drizzle: vi.fn(),
}));

const TENANT = '00000000-0000-0000-0000-0000000000aa';
const INSPECTOR = 'user-inspector-1';
const OTHER_INSPECTOR = 'user-inspector-2';
const MANAGER = 'user-manager-1';

/** 2026-08-03 is a Monday, so start+5/start+6 land on the weekend. */
const START = '2026-08-03';
const BLOCKED_DAY = '2026-08-04';
const HOLIDAY = '2026-08-05';
const HOLIDAY_NAME = 'Company Retreat';

type Role = 'owner' | 'manager' | 'inspector';

function buildApp(userId: string, role: Role) {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('user', { sub: userId, role } as HonoConfig['Variables']['user']);
        c.set('userRole', role);
        c.set('tenantId', TENANT);
        await next();
    });
    app.route('/api/schedule', weekSummaryRoutes);
    return { app, env: { DB: {} as D1Database } };
}

type DaySummary = { date: string; status: string; label?: string };

async function fetchDays(
    userId: string,
    role: Role,
    query = `start=${START}`,
): Promise<{ status: number; days: DaySummary[]; body: unknown }> {
    const { app, env } = buildApp(userId, role);
    const res = await app.request(`/api/schedule/week-summary?${query}`, {}, env);
    const body = await res.json() as { data?: { days: DaySummary[] } };
    return { status: res.status, days: body.data?.days ?? [], body };
}

describe('schedule week-summary', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        sqlite = fixture.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as ReturnType<typeof vi.fn>).mockReturnValue(testDb);

        const now = new Date();
        await testDb.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: now,
        });
        await testDb.insert(schema.users).values([
            {
                id: INSPECTOR, tenantId: TENANT, email: 'inspector-1@acme.com',
                passwordHash: 'hash', role: 'inspector', createdAt: now,
            },
            {
                id: OTHER_INSPECTOR, tenantId: TENANT, email: 'inspector-2@acme.com',
                passwordHash: 'hash', role: 'inspector', createdAt: now,
            },
            {
                id: MANAGER, tenantId: TENANT, email: 'manager@acme.com',
                passwordHash: 'hash', role: 'manager', createdAt: now,
            },
        ]);
        await testDb.insert(schema.tenantConfigs).values({
            tenantId: TENANT,
            updatedAt: now,
            defaultTimezone: 'America/New_York',
            holidayRegion: 'US',
            holidayPublicPolicy: 'open',
            holidayInternalPolicy: 'advisory',
        });
        // Weekday hours for both inspectors; the weekend stays unconfigured.
        await testDb.insert(schema.availability).values(
            [1, 2, 3, 4, 5].flatMap((dayOfWeek) => [INSPECTOR, OTHER_INSPECTOR].map((inspectorId) => ({
                id: `avail-${inspectorId}-${dayOfWeek}`,
                tenantId: TENANT,
                inspectorId,
                dayOfWeek,
                startTime: '08:00',
                endTime: '10:00',
                createdAt: now,
            }))),
        );
        // Both inspectors are fully blocked on start+1, so the day has hours but no bookable slot.
        await testDb.insert(schema.calendarBlocks).values(
            [INSPECTOR, OTHER_INSPECTOR].map((userId) => ({
                id: `block-${userId}`,
                tenantId: TENANT,
                userId,
                title: 'Time off',
                date: BLOCKED_DAY,
                allDay: true,
                createdAt: now,
                updatedAt: now,
            })),
        );
        await testDb.insert(schema.tenantCustomHolidays).values({
            id: 'holiday-1', tenantId: TENANT, date: HOLIDAY,
            name: HOLIDAY_NAME, createdAt: now, updatedAt: now,
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        sqlite.close();
    });

    it('returns seven consecutive civil dates starting at start', async () => {
        const { status, days } = await fetchDays(MANAGER, 'manager');
        expect(status).toBe(200);
        expect(days.map((d) => d.date)).toEqual([
            '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06',
            '2026-08-07', '2026-08-08', '2026-08-09',
        ]);
    });

    it('marks a fully blocked day full and a normal weekday open', async () => {
        const { days } = await fetchDays(MANAGER, 'manager');
        const byDate = new Map(days.map((d) => [d.date, d]));
        expect(byDate.get(START)?.status).toBe('open');
        expect(byDate.get(BLOCKED_DAY)?.status).toBe('full');
    });

    it('marks a company holiday closed and carries its name as the label', async () => {
        const { days } = await fetchDays(MANAGER, 'manager');
        const holiday = days.find((d) => d.date === HOLIDAY);
        expect(holiday?.status).toBe('closed');
        expect(holiday?.label).toBe(HOLIDAY_NAME);
    });

    it('marks days without any availability windows unconfigured', async () => {
        const { days } = await fetchDays(MANAGER, 'manager');
        const byDate = new Map(days.map((d) => [d.date, d]));
        expect(byDate.get('2026-08-08')?.status).toBe('unconfigured');
        expect(byDate.get('2026-08-09')?.status).toBe('unconfigured');
    });

    it('rejects a start that is not a civil date', async () => {
        const { status } = await fetchDays(MANAGER, 'manager', 'start=08/03/2026');
        expect(status).toBe(400);
    });

    it('scopes an admin summary to the requested userId', async () => {
        // Only the other inspector is blocked now, so a userId-scoped read must
        // reflect that user alone rather than the tenant-wide union.
        await testDb.delete(schema.calendarBlocks)
            .where(eq(schema.calendarBlocks.userId, INSPECTOR));
        const { days } = await fetchDays(MANAGER, 'manager', `start=${START}&userId=${OTHER_INSPECTOR}`);
        expect(days.find((d) => d.date === BLOCKED_DAY)?.status).toBe('full');

        const self = await fetchDays(MANAGER, 'manager', `start=${START}&userId=${INSPECTOR}`);
        expect(self.days.find((d) => d.date === BLOCKED_DAY)?.status).toBe('open');
    });

    it('forces a non-admin summary to the caller regardless of userId', async () => {
        // Only the other inspector is blocked; an inspector asking about them
        // must still receive their own (unblocked) week.
        await testDb.delete(schema.calendarBlocks)
            .where(eq(schema.calendarBlocks.userId, INSPECTOR));
        const { status, days } = await fetchDays(
            INSPECTOR, 'inspector', `start=${START}&userId=${OTHER_INSPECTOR}`,
        );
        expect(status).toBe(200);
        expect(days.find((d) => d.date === BLOCKED_DAY)?.status).toBe('open');
    });

    it('batches shared setup and calls getTenantSlots at most once per day', async () => {
        const slotSpy = vi.spyOn(BookingService.prototype, 'getTenantSlots');
        const qualifiedSpy = vi.spyOn(BookingService.prototype, 'getQualifiedInspectorIds');

        const { days } = await fetchDays(MANAGER, 'manager');

        expect(days).toHaveLength(7);
        expect(slotSpy.mock.calls.length).toBeLessThanOrEqual(7);
        // Closed and unconfigured days never need the slot engine at all.
        expect(slotSpy.mock.calls.length).toBeLessThanOrEqual(4);
        // The qualified-inspector set is day-invariant: resolve it once for the week.
        expect(qualifiedSpy).toHaveBeenCalledTimes(1);
        // ...and hand it to every per-day call so they never re-resolve it.
        for (const call of slotSpy.mock.calls) {
            expect(call[3]).toBeDefined();
        }
    });
});
