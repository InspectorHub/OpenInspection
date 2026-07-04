import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { createTestDb, setupSchema } from '../db';
import { BookingService } from '../../../server/services/booking.service';
import {
    tenants,
    users,
    availability,
    inspections,
    inspectionInspectors,
    inspectionRequests,
} from '../../../server/lib/db/schema';
import type { HonoConfig } from '../../../server/types/hono';
import { AppError } from '../../../server/lib/errors';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';

/**
 * B-28 — public booking TOCTOU (slot read and inspection insert are not
 * atomic; D1 has no row locks). Strategy: allow the race, then run a
 * deterministic post-insert recheck. Both racers see the same conflicting
 * rows, sort them by (createdAt, id), and the LATER one self-compensates
 * (deletes its own rows, 409s) while the earlier one proceeds — exactly one
 * winner, no coordination needed.
 *
 * Also covers the adjacent WRITE bug found while scoping B-28: the legacy
 * single-service path stored `date: body.date` (date-only) while every busy
 * check reads the HH:MM at slice(11,16) of an ISO datetime — so those
 * bookings never marked their slot busy and even SEQUENTIAL double-booking
 * succeeded. The path must store the full start ISO like the multi-service
 * path does.
 */

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// Must import AFTER the drizzle mock.
// eslint-disable-next-line import/order
import { bookingsRoutes } from '../../../server/api/bookings';

vi.mock('../../../server/lib/rate-limit', () => ({
    checkRateLimit: vi.fn().mockResolvedValue(undefined),
}));

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-0000000000b1';
const TENANT_SLUG = 'toctou-test';
// 2026-07-07 is a Tuesday (dayOfWeek = 2). Keep future-dated.
const TEST_DATE = '2026-07-07';
const SLOT_ISO = `${TEST_DATE}T08:00:00Z`;

const FAKE_ENV = { DB: {} } as HonoConfig['Bindings'];
const FAKE_EXEC_CTX = {
    waitUntil: (p: Promise<unknown>) => { void p.catch(() => {}); },
    passThroughOnException: () => {},
} as ExecutionContext;

function bookingBody(overrides: Record<string, unknown> = {}) {
    return {
        tenant: TENANT_SLUG,
        address: '123 Race Condition Rd, City, ST 12345',
        clientName: 'Client One',
        clientEmail: 'client1@example.com',
        date: TEST_DATE,
        timeSlot: 'morning',
        ...overrides,
    };
}

describe('B-28 booking TOCTOU', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: any;
    let svc: BookingService;

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db as BetterSQLite3Database<typeof schema>;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as any).mockReturnValue(db);
        svc = new BookingService({} as any);

        await db.insert(tenants).values({
            id: TENANT_ID, name: 'TOCTOU Inspections', slug: TENANT_SLUG,
            tier: 'free', status: 'active', maxUsers: 5,
            deploymentMode: 'shared', createdAt: new Date(),
        } as any);
        await db.insert(users).values({
            id: 'insp-1', tenantId: TENANT_ID, email: 'insp1@x.com',
            passwordHash: 'h', role: 'inspector', name: 'Solo Inspector',
            createdAt: new Date(),
        });
        await db.insert(availability).values({
            id: 'av-1', tenantId: TENANT_ID, inspectorId: 'insp-1',
            dayOfWeek: 2, startTime: '08:00', endTime: '10:00', createdAt: new Date(),
        });
    });
    afterEach(() => sqlite.close());

    /** Seed a competing booking (request + inspection + link row). */
    async function seedCompetitor(opts: {
        id: string; requestId: string | null; createdAt: Date;
        dateIso?: string; status?: string;
    }) {
        if (opts.requestId) {
            await db.insert(inspectionRequests).values({
                id: opts.requestId, tenantId: TENANT_ID,
                clientName: 'Rival', propertyAddress: '9 Other St',
                scheduledAt: opts.dateIso ?? SLOT_ISO, status: 'pending',
                totalAmount: 0, paymentStatus: 'unpaid',
                createdAt: opts.createdAt, updatedAt: opts.createdAt,
            });
        }
        await db.insert(inspections).values({
            id: opts.id, tenantId: TENANT_ID, inspectorId: 'insp-1',
            propertyAddress: '9 Other St', clientName: 'Rival',
            date: opts.dateIso ?? SLOT_ISO,
            status: (opts.status ?? 'draft') as any,
            paymentStatus: 'unpaid', price: 0,
            requestId: opts.requestId, createdAt: opts.createdAt,
        });
        await db.insert(inspectionInspectors).values({
            inspectionId: opts.id, userId: 'insp-1', tenantId: TENANT_ID,
            role: 'lead', createdAt: opts.createdAt,
        });
    }

    // ── Service-level: deterministic arbitration ────────────────────────────

    describe('arbitrateSlotRace', () => {
        const T0 = new Date('2026-07-01T00:00:00Z');
        const T1 = new Date('2026-07-01T00:00:01Z');

        async function seedMine(createdAt: Date, id = 'mine-1') {
            await seedCompetitor({ id, requestId: 'req-mine', createdAt });
        }

        it('wins when there is no competitor at the slot', async () => {
            await seedMine(T0);
            expect(await svc.arbitrateSlotRace(TENANT_ID, 'insp-1', TEST_DATE, '08:00', 'req-mine')).toBe('win');
        });

        it('loses when a foreign booking at the same slot is earlier', async () => {
            await seedCompetitor({ id: 'rival-1', requestId: 'req-rival', createdAt: T0 });
            await seedMine(T1);
            expect(await svc.arbitrateSlotRace(TENANT_ID, 'insp-1', TEST_DATE, '08:00', 'req-mine')).toBe('lose');
        });

        it('wins when mine is earlier than the foreign booking', async () => {
            await seedMine(T0);
            await seedCompetitor({ id: 'rival-1', requestId: 'req-rival', createdAt: T1 });
            expect(await svc.arbitrateSlotRace(TENANT_ID, 'insp-1', TEST_DATE, '08:00', 'req-mine')).toBe('win');
        });

        it('breaks createdAt ties deterministically by inspection id', async () => {
            // Same timestamp; 'aaa-mine' sorts before 'zzz-rival' → mine wins.
            await seedCompetitor({ id: 'aaa-mine', requestId: 'req-mine', createdAt: T0 });
            await seedCompetitor({ id: 'zzz-rival', requestId: 'req-rival', createdAt: T0 });
            expect(await svc.arbitrateSlotRace(TENANT_ID, 'insp-1', TEST_DATE, '08:00', 'req-mine')).toBe('win');
            // Mirror image: the rival running the same recheck must conclude 'lose'.
            expect(await svc.arbitrateSlotRace(TENANT_ID, 'insp-1', TEST_DATE, '08:00', 'req-rival')).toBe('lose');
        });

        it('counts a requestId-less (wizard/admin) row as a competitor', async () => {
            await seedCompetitor({ id: 'admin-1', requestId: null, createdAt: T0 });
            await seedMine(T1);
            expect(await svc.arbitrateSlotRace(TENANT_ID, 'insp-1', TEST_DATE, '08:00', 'req-mine')).toBe('lose');
        });

        it('ignores cancelled competitors', async () => {
            await seedCompetitor({ id: 'rival-1', requestId: 'req-rival', createdAt: T0, status: 'cancelled' });
            await seedMine(T1);
            expect(await svc.arbitrateSlotRace(TENANT_ID, 'insp-1', TEST_DATE, '08:00', 'req-mine')).toBe('win');
        });

        it('ignores competitors at a different time on the same date', async () => {
            await seedCompetitor({ id: 'rival-1', requestId: 'req-rival', createdAt: T0, dateIso: `${TEST_DATE}T09:00:00Z` });
            await seedMine(T1);
            expect(await svc.arbitrateSlotRace(TENANT_ID, 'insp-1', TEST_DATE, '08:00', 'req-mine')).toBe('win');
        });
    });

    describe('revokeBooking', () => {
        it('deletes the request, its inspections, and their link rows', async () => {
            await seedCompetitor({ id: 'mine-1', requestId: 'req-mine', createdAt: new Date() });
            await seedCompetitor({ id: 'rival-1', requestId: 'req-rival', createdAt: new Date() });

            await svc.revokeBooking(TENANT_ID, 'req-mine');

            expect(await db.select().from(inspections).all()).toHaveLength(1);
            expect((await db.select().from(inspections).all())[0]!.id).toBe('rival-1');
            const links = await db.select().from(inspectionInspectors).all();
            expect(links).toHaveLength(1);
            expect(links[0]!.inspectionId).toBe('rival-1');
            const reqs = await db.select().from(inspectionRequests).all();
            expect(reqs.map(r => r.id)).toEqual(['req-rival']);
        });
    });

    // ── Route-level: wiring into POST /book ────────────────────────────────

    function buildApp() {
        const app = new OpenAPIHono<HonoConfig>();
        app.onError((err, c) => {
            if (err instanceof AppError) {
                return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
            }
            return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
        });
        app.use('*', async (c, next) => {
            c.set('services', {
                booking: svc,
                email: { sendBookingConfirmation: vi.fn().mockResolvedValue(undefined) },
                notification: { createForAllAdmins: vi.fn().mockResolvedValue(undefined) },
            } as unknown as HonoConfig['Variables']['services']);
            await next();
        });
        app.route('/', bookingsRoutes);
        (mockDrizzle as any).mockReturnValue(db);
        return app;
    }

    function postBook(app: OpenAPIHono<HonoConfig>, body: Record<string, unknown>) {
        return app.request('/book', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        }, FAKE_ENV, FAKE_EXEC_CTX);
    }

    it('single-service booking stores the full start ISO datetime, not the bare date', async () => {
        const app = buildApp();
        const res = await postBook(app, bookingBody());
        expect(res.status).toBe(200);

        const rows = await db.select().from(inspections).all();
        expect(rows).toHaveLength(1);
        // Busy checks read HH:MM at slice(11,16); a bare date never blocks anything.
        expect(rows[0]!.date).toBe(SLOT_ISO);
    });

    it('sequential double-booking of the same slot is rejected with 409', async () => {
        const app = buildApp();
        expect((await postBook(app, bookingBody())).status).toBe(200);

        const res2 = await postBook(app, bookingBody({
            clientName: 'Client Two', clientEmail: 'client2@example.com',
        }));
        expect(res2.status).toBe(409);
        expect(await db.select().from(inspections).all()).toHaveLength(1);
    });

    it('TOCTOU race: the later racer self-compensates (rows deleted) and 409s; the earlier booking survives', async () => {
        const app = buildApp();

        // Deterministic race repro: the competitor lands AFTER the advisory
        // slot read but BEFORE our insert — exactly the TOCTOU window.
        const realGetTenantSlots = svc.getTenantSlots.bind(svc);
        vi.spyOn(svc, 'getTenantSlots').mockImplementation(async (...args) => {
            const slots = await realGetTenantSlots(...args);
            await seedCompetitor({
                id: 'rival-1', requestId: 'req-rival',
                // Clearly earlier than the row the handler is about to insert.
                createdAt: new Date(Date.now() - 60_000),
            });
            return slots;
        });

        const res = await postBook(app, bookingBody());
        expect(res.status).toBe(409);

        // Loser's rows are fully compensated away; winner's are intact.
        const rows = await db.select().from(inspections).all();
        expect(rows.map(r => r.id)).toEqual(['rival-1']);
        const links = await db.select().from(inspectionInspectors).all();
        expect(links.map(l => l.inspectionId)).toEqual(['rival-1']);
        const reqs = await db.select().from(inspectionRequests).all();
        expect(reqs.map(r => r.id)).toEqual(['req-rival']);
    });
});
