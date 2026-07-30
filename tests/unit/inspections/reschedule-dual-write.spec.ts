/**
 * Roadmap §7.5 item 3 — a date PATCH moves the civil day AND the precise
 * scheduled instant, preserving wall-clock time-of-day in the TENANT timezone.
 *
 * Two live defects this spec was written red against:
 *   1. Calendar drag-reschedule posts a bare `YYYY-MM-DD`
 *      (MonthView/WeekView/DayView all pass `dateStr`), which
 *      `z.string().datetime()` REJECTED — every drag 400'd and the calendar
 *      action swallowed `res.ok`. The drag persisted NOTHING.
 *   2. Even with a passing payload (the settings sheet's ISO conversion), the
 *      handler wrote only `inspections.date`; `scheduled_start_ms` — the truth
 *      source for conflict detection and calendar push — kept the OLD instant.
 *
 * Exercises the REAL mounted route (RBAC + zod + handler) against in-memory
 * SQLite, mirroring inspection-patch-settings.spec.ts.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { OpenAPIHono } from '@hono/zod-openapi';
import { inspectionsRoutes } from '../../../server/api/inspections';
import { wallClockToEpochMs } from '../../../server/lib/tz';
import type { HonoConfig } from '../../../server/types/hono';

const TENANT = '00000000-0000-0000-0000-000000000001';
const USER_ID = '00000000-0000-0000-0000-000000000300';
const INSP_ID = '550e8400-e29b-41d4-a716-446655440077';
const TZ = 'America/New_York';

let db: BetterSQLite3Database<typeof schema>;

function buildApp() {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('userRole', 'manager' as never);
        c.set('tenantId', TENANT);
        c.set('user', { sub: USER_ID } as never);
        c.set('services', {
            inspection: {
                getInspection: vi.fn().mockResolvedValue({ inspection: { status: 'requested' } }),
                isInspectionPhotoKey: vi.fn().mockResolvedValue(false),
            },
        } as never);
        await next();
    });
    app.route('/api/inspections', inspectionsRoutes);
    return app;
}

async function patchDate(date: string): Promise<number> {
    const res = await buildApp().request(
        `/api/inspections/${INSP_ID}`,
        { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ date }) },
        { DB: {} },
    );
    return res.status;
}

async function readRow() {
    return db.select().from(schema.inspections).where(eq(schema.inspections.id, INSP_ID)).get();
}

function toMs(v: unknown): number | null {
    if (v == null) return null;
    return v instanceof Date ? v.getTime() : Number(v);
}

async function seed(over: Partial<{ date: string; startMs: number | null; endMs: number | null }> = {}) {
    await db.insert(schema.tenants).values({
        id: TENANT, name: 'A', slug: 's', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await db.insert(schema.tenantConfigs).values({
        tenantId: TENANT, defaultTimezone: TZ, updatedAt: new Date(),
    } as never);
    const startMs = over.startMs === undefined ? wallClockToEpochMs('2026-01-15', '10:00', TZ) : over.startMs;
    await db.insert(schema.inspections).values({
        id: INSP_ID, tenantId: TENANT, propertyAddress: '1 Main St',
        date: over.date ?? '2026-01-15T10:00:00Z',
        status: 'requested', paymentStatus: 'unpaid', price: 50000, createdAt: new Date(),
        scheduledStartMs: startMs == null ? null : new Date(startMs),
        scheduledEndMs: over.endMs === undefined
            ? (startMs == null ? null : new Date(startMs + 180 * 60000))
            : (over.endMs == null ? null : new Date(over.endMs)),
        durationMin: 180,
    });
}

describe('PATCH /api/inspections/:id — reschedule dual-write (§7.5 item 3)', () => {
    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    });

    it('accepts the calendar drag payload — a bare civil date is 200, not 400', async () => {
        await seed();
        expect(await patchDate('2026-01-20')).toBe(200);
    });

    it('moves scheduled_start_ms with the date, preserving tenant wall-clock time', async () => {
        await seed();
        await patchDate('2026-01-20');
        const row = await readRow();
        // 10:00 America/New_York on the NEW day.
        expect(toMs(row?.scheduledStartMs)).toBe(wallClockToEpochMs('2026-01-20', '10:00', TZ));
        // End shifts by the same delta — duration survives.
        expect(toMs(row?.scheduledEndMs)).toBe(wallClockToEpochMs('2026-01-20', '10:00', TZ) + 180 * 60000);
    });

    it('keeps the stored time suffix on `date` (it keys the HH:MM busy-checks)', async () => {
        await seed({ date: '2026-01-15T10:00:00Z' });
        await patchDate('2026-01-20');
        const row = await readRow();
        expect(row?.date).toBe('2026-01-20T10:00:00Z');
    });

    it('crossing a DST boundary preserves WALL-CLOCK time, not the UTC offset', async () => {
        await seed(); // Jan 15 = EST (UTC-5)
        await patchDate('2026-07-20'); // July = EDT (UTC-4)
        const row = await readRow();
        const expected = wallClockToEpochMs('2026-07-20', '10:00', TZ);
        expect(toMs(row?.scheduledStartMs)).toBe(expected);
        // Sanity: a naive whole-days shift in UTC would land one hour off.
        expect(toMs(row?.scheduledStartMs)).not.toBe(
            wallClockToEpochMs('2026-01-15', '10:00', TZ) + 186 * 24 * 3600_000,
        );
    });

    it('a legacy row with no scheduled instant updates date only, ms stays NULL', async () => {
        await seed({ date: '2026-01-15', startMs: null, endMs: null });
        expect(await patchDate('2026-01-20')).toBe(200);
        const row = await readRow();
        expect(row?.date).toBe('2026-01-20');
        expect(row?.scheduledStartMs).toBeNull();
        expect(row?.scheduledEndMs).toBeNull();
    });

    it('the settings-sheet ISO payload also dual-writes', async () => {
        await seed();
        expect(await patchDate('2026-02-03T09:00:00.000Z')).toBe(200);
        const row = await readRow();
        expect(toMs(row?.scheduledStartMs)).toBe(wallClockToEpochMs('2026-02-03', '10:00', TZ));
    });
});
