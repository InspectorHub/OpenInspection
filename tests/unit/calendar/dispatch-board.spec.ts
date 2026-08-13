/**
 * GET /api/calendar/dispatch — the board feed.
 *
 * HTTP-level against `app.request` for the same reason the reschedule spec is:
 * the gate is middleware. `requireCapability('scheduleOthers')` is what decides
 * who may see the whole team's day, and a test that called the handler directly
 * would answer 200 for everybody.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { HonoConfig } from '../../../server/types/hono';
import type { UserRole } from '../../../server/types/auth';
import { AppError } from '../../../server/lib/errors';
import { INSPECTION_STATUS } from '../../../server/lib/status/inspection-status';
import { REPORT_STATUS } from '../../../server/lib/status/report-status';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// eslint-disable-next-line import/order
import calendarRoutes from '../../../server/api/calendar';

const TENANT = '00000000-0000-0000-0000-000000000001';
const ACTOR = '00000000-0000-0000-0000-000000000099';
const ZOE = '00000000-0000-0000-0000-0000000000a1';
const ADAM = '00000000-0000-0000-0000-0000000000b2';
const DAY = '2026-06-01';
const START_MS = Date.UTC(2026, 5, 1, 9, 0, 0);

const FAKE_ENV = { DB: {} } as HonoConfig['Bindings'];

interface BoardPayload {
    date: string;
    conflictPolicy: string;
    slotIntervalMin: number;
    dayStartMs: number;
    inspectors: Array<{ id: string; name: string | null }>;
    items: Array<{ id: string; kind: string; allDay: boolean; startTime?: string; userId?: string; meta?: Record<string, unknown> }>;
    unassigned: Array<{ id: string }>;
}

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

    app.route('/api/calendar', calendarRoutes);
    return app;
}

async function seedInspection(
    db: BetterSQLite3Database<typeof schema>,
    id: string,
    overrides: Partial<typeof schema.inspections.$inferInsert> = {},
) {
    await db.insert(schema.inspections).values({
        id,
        tenantId: TENANT,
        propertyAddress: `${id} St`,
        date: DAY,
        status: INSPECTION_STATUS.SCHEDULED,
        reportStatus: REPORT_STATUS.IN_PROGRESS,
        paymentStatus: 'unpaid',
        price: 0,
        paymentRequired: false,
        agreementRequired: false,
        createdAt: new Date(),
        ...overrides,
    });
}

describe('GET /api/calendar/dispatch', () => {
    let db: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db as BetterSQLite3Database<typeof schema>;
        await setupSchema(fixture.sqlite);
        await db.insert(schema.tenants).values({
            id: TENANT, slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        // Adverse insert order: Zoe first, Adam second. A response that happened
        // to come back in insertion order would fail the sort assertion rather
        // than pass by accident.
        await db.insert(schema.users).values([
            { id: ZOE, tenantId: TENANT, email: 'zoe@example.com', name: 'Zoe', role: 'inspector', passwordHash: 'h', createdAt: new Date() },
            { id: ADAM, tenantId: TENANT, email: 'adam@example.com', name: 'Adam', role: 'inspector', passwordHash: 'h', createdAt: new Date() },
            { id: ACTOR, tenantId: TENANT, email: 'owner@example.com', name: 'Owner', role: 'owner', passwordHash: 'h', createdAt: new Date() },
        ]);
        await db.insert(schema.tenantConfigs).values({
            tenantId: TENANT, defaultTimezone: 'UTC', updatedAt: new Date(),
        });
    });

    const get = (app: ReturnType<typeof buildApp>, date = DAY) =>
        app.request(`/api/calendar/dispatch?date=${date}`, {}, FAKE_ENV);

    it('inspector without the scheduleOthers override → 403', async () => {
        const res = await get(buildApp(db, 'inspector'));
        expect(res.status).toBe(403);
    });

    it('inspector WITH the scheduleOthers override → 200', async () => {
        const res = await get(buildApp(db, 'inspector', { scheduleOthers: true }));
        expect(res.status).toBe(200);
    });

    it('owner → 200 with the roster sorted by display name', async () => {
        const res = await get(buildApp(db, 'owner'));
        expect(res.status).toBe(200);
        const body = await res.json() as { data: BoardPayload };
        expect(body.data.inspectors.map((i) => i.name)).toEqual(['Adam', 'Owner', 'Zoe']);
        expect(body.data.date).toBe(DAY);
        expect(body.data.conflictPolicy).toBe('advisory');
    });

    it('ships the snap lattice and the tenant-local midnight a drag needs', async () => {
        const res = await get(buildApp(db, 'owner'));
        const body = await res.json() as { data: BoardPayload };
        // Not decoration: the board turns a dropped pixel into an instant with
        // dayStartMs + minutes*60000, so a wrong or missing anchor silently
        // reschedules to the wrong day, and a wrong interval produces starts the
        // booking engine would never have offered.
        expect(body.data.slotIntervalMin).toBe(30);
        expect(body.data.dayStartMs).toBe(Date.UTC(2026, 5, 1, 0, 0, 0));
    });

    it('echoes a non-default booking_slot_interval_min rather than assuming 30', async () => {
        await db.update(schema.tenantConfigs)
            .set({ bookingSlotIntervalMin: 45 })
            .where(eq(schema.tenantConfigs.tenantId, TENANT));
        const res = await get(buildApp(db, 'owner'));
        const body = await res.json() as { data: BoardPayload };
        expect(body.data.slotIntervalMin).toBe(45);
    });

    it('echoes the tenant booking_conflict_policy', async () => {
        await db.update(schema.tenantConfigs)
            .set({ bookingConflictPolicy: 'block' })
            .where(eq(schema.tenantConfigs.tenantId, TENANT));
        const res = await get(buildApp(db, 'owner'));
        const body = await res.json() as { data: BoardPayload };
        expect(body.data.conflictPolicy).toBe('block');
    });

    it('layers the scheduled instant onto inspection items', async () => {
        await seedInspection(db, 'timed-1', {
            scheduledStartMs: new Date(START_MS),
            scheduledEndMs: new Date(START_MS + 90 * 60_000),
            durationMin: 90,
        });
        await db.insert(schema.inspectionInspectors).values({
            inspectionId: 'timed-1', userId: ADAM, tenantId: TENANT, role: 'lead', createdAt: new Date(),
        });

        const res = await get(buildApp(db, 'owner'));
        const body = await res.json() as { data: BoardPayload };
        const item = body.data.items.find((i) => i.id === 'timed-1');
        expect(item?.allDay).toBe(false);
        expect(item?.startTime).toBe('09:00');
        expect(item?.meta?.scheduledStartMs).toBe(START_MS);
        expect(item?.meta?.durationMin).toBe(90);
    });

    it('leaves an inspection with no instant all-day', async () => {
        await seedInspection(db, 'untimed-1');
        const res = await get(buildApp(db, 'owner'));
        const body = await res.json() as { data: BoardPayload };
        expect(body.data.items.find((i) => i.id === 'untimed-1')?.allDay).toBe(true);
    });

    it('puts only the nobody-assigned inspections in the unassigned lane', async () => {
        await seedInspection(db, 'assigned-1');
        await db.insert(schema.inspectionInspectors).values({
            inspectionId: 'assigned-1', userId: ZOE, tenantId: TENANT, role: 'lead', createdAt: new Date(),
        });
        await seedInspection(db, 'orphan-1');
        // Legacy rows carry the assignment on the column instead of the link
        // table; those are NOT unassigned, and a filter that only looked at the
        // link table would wrongly sweep them into the lane.
        await seedInspection(db, 'legacy-1', { inspectorId: ZOE });

        const res = await get(buildApp(db, 'owner'));
        const body = await res.json() as { data: BoardPayload };
        expect(body.data.unassigned.map((i) => i.id)).toEqual(['orphan-1']);
        expect(body.data.items.map((i) => i.id).sort()).toEqual(['assigned-1', 'legacy-1', 'orphan-1']);
    });
});
