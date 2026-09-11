/**
 * A requested time WINDOW is satisfied by any free slot inside it.
 *
 * `admitBooking` used to turn the window into a single clock reading —
 * `morning` and `all-day` both became the string '08:00', `afternoon` became
 * '13:00' — and then looked for a slot whose time matched it exactly. The slot
 * grid is built from the tenant's own opening hours, so the two only ever met
 * when the tenant happened to open at 08:00.
 *
 * A company that opens at nine could therefore not be booked for Morning or
 * for All Day, on any surface, on any date. Morning is the FIRST option in the
 * public booking form's time picker, and All Day is what the embedded booking
 * widget sends because it has no picker at all.
 *
 * Measured against a running worker before this changed, one tenant open
 * Mon-Fri 09:00-17:00, all three on the same date:
 *
 *     afternoon -> booked          morning -> conflict          all-day -> conflict
 *
 * WHY THE EXISTING SUITE WAS GREEN. Every booking spec in this directory seeds
 * availability at 08:00, so the hardcoded '08:00' always found its slot. The
 * fixtures supplied the one opening hour production rarely has. These tests
 * seed 09:00-17:00 for that reason and no other.
 *
 * The window boundaries are the ones the product already promises in
 * `windowLabelFor` and in the picker's own copy: morning is before noon,
 * afternoon is noon onward, all day is "flexible timing". `custom` is
 * unchanged and still matches exactly — a caller naming a time is asking for
 * that time, not for a window.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { createTestDb, setupSchema } from '../db';
import {
    tenants, users, availability, inspections, inspectionInspectors,
    tenantConfigs,
} from '../../../server/lib/db/schema';
import * as schema from '../../../server/lib/db/schema';
import type { HonoConfig } from '../../../server/types/hono';
import { AppError } from '../../../server/lib/errors';
import { BookingService } from '../../../server/services/booking.service';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

vi.mock('../../../server/lib/rate-limit', () => ({
    checkRateLimit: vi.fn().mockResolvedValue(undefined),
}));

// eslint-disable-next-line import/order
import { bookingsRoutes } from '../../../server/api/bookings';
import { makeExecutionContext } from '../helpers/exec-ctx';
import { nextWeekday } from '../helpers/bookable-date';

/** 2026-06-08 is a Monday (dayOfWeek = 1). */
const MONDAY = nextWeekday(1);
const T1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const U1 = 'bbbbbbbb-0000-4000-8000-000000000001';

const FAKE_ENV = { DB: {} as D1Database } as unknown as HonoConfig['Bindings'];
const FAKE_EXEC_CTX: ExecutionContext = makeExecutionContext().ctx;

function makeServiceStubs(bookingSvc: BookingService) {
    return {
        booking: bookingSvc,
        widget: {
            isOriginAllowed: vi.fn().mockResolvedValue(true),
            recordEvent: vi.fn().mockResolvedValue(undefined),
        },
        email: { sendBookingConfirmation: vi.fn().mockResolvedValue(undefined) },
        notification: { createForAllAdmins: vi.fn().mockResolvedValue(undefined) },
        automation: { trigger: vi.fn().mockResolvedValue(undefined) },
        inspectionRequest: {
            create: vi.fn().mockResolvedValue({ id: 'req-x', inspections: [{ id: 'insp-x' }] }),
        },
    };
}

function buildApp(db: BetterSQLite3Database<typeof schema>, bookingSvc: BookingService) {
    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        }
        return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
    });
    const stubs = makeServiceStubs(bookingSvc);
    app.use('*', async (c, next) => {
        c.set('services', stubs as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    app.route('/', bookingsRoutes);
    (mockDrizzle as ReturnType<typeof vi.fn>).mockReturnValue(db);
    return app;
}

/** One inspector, open the ordinary nine to five. Nothing booked yet. */
async function seedNineToFive(db: BetterSQLite3Database<typeof schema>) {
    await db.insert(tenants).values({
        id: T1, slug: 'acme', tier: 'free', status: 'active',
        maxUsers: 5, deploymentMode: 'shared', createdAt: new Date(),
    } as never);
    await db.insert(users).values({
        id: U1, tenantId: T1, email: 'alice@acme.com', passwordHash: 'h',
        role: 'inspector', name: 'Alice', createdAt: new Date(),
    } as never);
    await db.insert(availability).values({
        id: 'a1', tenantId: T1, inspectorId: U1, dayOfWeek: 1,
        startTime: '09:00', endTime: '17:00', createdAt: new Date(),
    } as never);
    // A DECLARED company timezone. Public booking refuses a workspace that never
    // set one (the NOT NULL default 'UTC' is the unset sentinel).
    await db.insert(tenantConfigs).values({
        tenantId: T1, updatedAt: new Date(), defaultTimezone: 'America/New_York',
    } as never);
}

function book(timeSlot: string, extra: Record<string, unknown> = {}) {
    return {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            tenant: 'acme',
            address: '123 Main St Anytown',
            clientName: 'Test Client',
            clientEmail: 'client@test.com',
            date: MONDAY,
            timeSlot,
            ...extra,
        }),
    };
}

describe('booking time windows against a tenant that opens at nine', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: { close: () => void };
    let svc: BookingService;

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db as BetterSQLite3Database<typeof schema>;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as ReturnType<typeof vi.fn>).mockReturnValue(db);
        svc = new BookingService({} as D1Database);
        await seedNineToFive(db);
    });

    afterEach(() => sqlite.close());

    /** The scheduled start actually written for the created inspection. */
    async function scheduledTimeOf(inspectionId: string): Promise<string> {
        const { eq } = await import('drizzle-orm');
        const row = await db.select().from(inspections).where(eq(inspections.id, inspectionId)).get();
        return String(row?.date).slice(11, 16);
    }

    it('takes a Morning booking and puts it at the first slot of the morning', async () => {
        const app = buildApp(db, svc);
        const res = await app.request('/book', book('morning'), FAKE_ENV, FAKE_EXEC_CTX);
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { inspectionId: string } };
        expect(await scheduledTimeOf(body.data.inspectionId)).toBe('09:00');
    });

    it('takes an All Day booking, which is what the embedded widget sends', async () => {
        const app = buildApp(db, svc);
        const res = await app.request('/book', book('all-day'), FAKE_ENV, FAKE_EXEC_CTX);
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { inspectionId: string } };
        expect(await scheduledTimeOf(body.data.inspectionId)).toBe('09:00');
    });

    // POSITIVE CONTROL: afternoon already worked, because 13:00 fell inside
    // 09:00-17:00 by luck. It must keep working, and must stay in the afternoon
    // rather than sliding to the first free slot of the day.
    it('still keeps an Afternoon booking in the afternoon', async () => {
        const app = buildApp(db, svc);
        const res = await app.request('/book', book('afternoon'), FAKE_ENV, FAKE_EXEC_CTX);
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { inspectionId: string } };
        expect(await scheduledTimeOf(body.data.inspectionId) >= '12:00').toBe(true);
    });

    // A window that is genuinely full must still be refused. Without this, a
    // change that simply stopped checking availability would pass everything
    // above.
    it('still refuses a window whose every slot is taken', async () => {
        // Fill the whole morning for the only inspector there is. The busy-time
        // scan reads the assignment rows, not `inspections.inspector_id`, so an
        // inspection without its `inspection_inspectors` row is invisible to it
        // — which is how this control first passed while asserting nothing.
        // The grid steps every 30 minutes by default, so filling only the
        // hours leaves the half-hours free — which is how this control first
        // read green while the morning was in fact wide open.
        const times = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30'];
        await db.insert(inspections).values(times.map((t, i) => ({
            id: `busy-${i}`, tenantId: T1, inspectorId: U1,
            propertyAddress: `${i} Busy Rd`, date: `${MONDAY}T${t}:00Z`,
            status: 'scheduled', createdAt: new Date(),
        })) as never);
        await db.insert(inspectionInspectors).values(times.map((_, i) => ({
            inspectionId: `busy-${i}`, userId: U1, tenantId: T1,
            role: 'lead', createdAt: new Date(),
        })) as never);

        const app = buildApp(db, svc);
        const res = await app.request('/book', book('morning'), FAKE_ENV, FAKE_EXEC_CTX);
        expect(res.status).toBe(409);
    });

    // `custom` names a time rather than a window, and must stay exact: a
    // request for 10:00 that quietly became 09:00 would be worse than a refusal.
    it('leaves a custom time exact', async () => {
        const app = buildApp(db, svc);
        const res = await app.request('/book', book('custom', { customTime: '10:00' }), FAKE_ENV, FAKE_EXEC_CTX);
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { inspectionId: string } };
        expect(await scheduledTimeOf(body.data.inspectionId)).toBe('10:00');
    });
});
