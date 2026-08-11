/**
 * GET /api/schedule/day-slots — staff Find-a-Time.
 *
 * HTTP-level, because the two things worth pinning here are both middleware or
 * boundary behaviour: the `scheduleOthers` gate (a handler-level test would
 * answer 200 for everybody), and the fact that a caller-supplied inspector list
 * NARROWS the qualified set rather than replacing it. The second one is the
 * quiet security-shaped bug: if an arbitrary id could be echoed back as "free",
 * the wizard would happily assign work to somebody who cannot take it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { HonoConfig } from '../../../server/types/hono';
import type { UserRole } from '../../../server/types/auth';
import { AppError } from '../../../server/lib/errors';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const getTenantSlots = vi.fn();
const getQualifiedInspectorIds = vi.fn();
vi.mock('../../../server/services/booking.service', () => ({
    BookingService: class {
        getTenantSlots = getTenantSlots;
        getQualifiedInspectorIds = getQualifiedInspectorIds;
    },
}));

// eslint-disable-next-line import/order
import scheduleRoutes from '../../../server/api/schedule-week-summary';

const TENANT = '00000000-0000-0000-0000-000000000001';
const ACTOR = '00000000-0000-0000-0000-000000000099';
const ADA = '00000000-0000-0000-0000-0000000000a1';
const BO = '00000000-0000-0000-0000-0000000000b2';
const DAY = '2026-06-01';

const FAKE_ENV = { DB: {} } as HonoConfig['Bindings'];

function buildApp(
    db: BetterSQLite3Database<typeof schema>,
    role: UserRole,
    overrides: Record<string, boolean> | null = null,
) {
    (mockDrizzle as ReturnType<typeof vi.fn>).mockReturnValue(db);
    const app = new OpenAPIHono<HonoConfig>();

    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        }
        return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
    });

    app.use('*', async (c, next) => {
        c.set('tenantId', TENANT);
        c.set('userRole', role);
        c.set('user', { sub: ACTOR, role, tenantId: TENANT });
        c.set('sdb', {
            getById: async () => ({ permissionOverrides: overrides }),
        } as unknown as HonoConfig['Variables']['sdb']);
        await next();
    });

    app.route('/api/schedule', scheduleRoutes);
    return app;
}

function get(app: OpenAPIHono<HonoConfig>, query = `date=${DAY}`) {
    return app.request(`/api/schedule/day-slots?${query}`, {}, FAKE_ENV);
}

interface SlotsPayload {
    date: string;
    intervalMin: number;
    slots: Array<{ time: string; available: boolean; inspectorIds: string[] }>;
    holidayAdvisory: { date: string; name: string } | null;
}

describe('GET /api/schedule/day-slots', () => {
    let db: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        getTenantSlots.mockReset();
        getQualifiedInspectorIds.mockReset();
        getQualifiedInspectorIds.mockResolvedValue([ADA, BO]);
        getTenantSlots.mockResolvedValue({
            slots: [{ time: '09:00', available: true, inspectorIds: [ADA] }],
        });
        await db.insert(schema.tenants).values({
            id: TENANT, slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await db.insert(schema.tenantConfigs).values({
            tenantId: TENANT,
            bookingSlotIntervalMin: 45,
            updatedAt: new Date(),
        });
    });

    it('inspector without the scheduleOthers override → 403', async () => {
        const res = await get(buildApp(db, 'inspector'));
        expect(res.status).toBe(403);
    });

    it('inspector WITH the scheduleOthers override → 200', async () => {
        const res = await get(buildApp(db, 'inspector', { scheduleOthers: true }));
        expect(res.status).toBe(200);
    });

    it('names the free inspectors — the part the public slots surface withholds', async () => {
        const res = await get(buildApp(db, 'owner'));
        expect(res.status).toBe(200);
        const body = await res.json() as { data: SlotsPayload };
        expect(body.data.slots[0].inspectorIds).toEqual([ADA]);
        expect(body.data.intervalMin).toBe(45);
    });

    it('NARROWS the qualified set with userIds instead of replacing it', async () => {
        const outsider = '00000000-0000-0000-0000-0000000000ff';
        await get(buildApp(db, 'owner'), `date=${DAY}&userIds=${ADA},${outsider}`);
        // ADA survives because she was qualified; the outsider does not become
        // bookable by being named in a query string.
        expect(getTenantSlots).toHaveBeenCalledWith(TENANT, DAY, [], [ADA]);
    });

    it('considers everyone qualified when no userIds are given', async () => {
        await get(buildApp(db, 'owner'));
        expect(getTenantSlots).toHaveBeenCalledWith(TENANT, DAY, [], [ADA, BO]);
    });

    it('rejects a malformed date rather than guessing one', async () => {
        const res = await get(buildApp(db, 'owner'), 'date=next-tuesday');
        expect(res.status).toBe(400);
    });
});
