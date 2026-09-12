/**
 * A BOOKED HOUR WITH NO DECLARED ZONE IS NOT A BOOKING.
 *
 * `tenant_configs.default_timezone` is `NOT NULL DEFAULT 'UTC'`, so a workspace
 * that has never opened Settings stores the same five characters as one that
 * genuinely operates in UTC. Reading that sentinel as a zone turned a visitor
 * picking `Morning (8:00 AM - 12:00 PM)` into the instant 08:00Z, and that
 * instant is what the .ics invite and the confirmation email tell the client —
 * 4 AM for a property on the US east coast. The checklist on the workspace's own
 * home page was asking for a timezone the whole time.
 *
 * So the product refuses instead of guessing, and it refuses BEFORE the first
 * write, where a stranger's form post can still be turned away without anything
 * to compensate. The positive control is the point of this file: a workspace that
 * DECLARES UTC (`Etc/UTC`) books normally. Without that case the gate would be
 * indistinguishable from "we stopped supporting UTC".
 *
 * The DST pairs are here because an offset captured once is the other classic
 * way this goes wrong: the same 08:00 in the same zone is a different instant in
 * October than in November, and a fix that only ever ran in summer looks right.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { createTestDb, setupSchema } from '../db';
import { BookingService } from '../../../server/services/booking.service';
import {
    tenants,
    users,
    availability,
    tenantConfigs,
    inspections,
} from '../../../server/lib/db/schema';
import { wallClockToEpochMs } from '../../../server/lib/tz';
import type { HonoConfig } from '../../../server/types/hono';
import { AppError } from '../../../server/lib/errors';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// eslint-disable-next-line import/order
import { bookingsRoutes } from '../../../server/api/bookings';
import { makeExecutionContext } from '../helpers/exec-ctx';

vi.mock('../../../server/lib/rate-limit', () => ({
    checkRateLimit: vi.fn().mockResolvedValue(undefined),
}));

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-0000000000t1';
const TENANT_SLUG = 'undeclared-zone';
const EASTERN = 'America/New_York';

/**
 * Fridays (dayOfWeek 5, matching the seeded availability row) chosen to sit on
 * opposite sides of both US transitions: the autumn fall-back (2026-11-01) and
 * the spring forward (2027-03-14). Eastern is GMT-4 on the first of each pair
 * and GMT-5 on the second / vice versa, so a single captured offset cannot
 * satisfy all four.
 */
const FRI_BEFORE_FALL_BACK = '2026-10-30'; // EDT, -04:00
const FRI_AFTER_FALL_BACK = '2026-11-06';  // EST, -05:00
const FRI_BEFORE_SPRING_FWD = '2027-03-12'; // EST, -05:00
const FRI_AFTER_SPRING_FWD = '2027-03-19';  // EDT, -04:00

const FAKE_ENV = { DB: {} } as HonoConfig['Bindings'];
const FAKE_EXEC_CTX = makeExecutionContext().ctx;

describe('public booking refuses a workspace with no declared timezone', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];
    let svc: BookingService;

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db as BetterSQLite3Database<typeof schema>;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as ReturnType<typeof vi.fn>).mockReturnValue(db);
        svc = new BookingService({} as D1Database);

        await db.insert(tenants).values({
            id: TENANT_ID, slug: TENANT_SLUG,
            tier: 'pro', status: 'active', maxUsers: 5,
            deploymentMode: 'shared', createdAt: new Date(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        await db.insert(users).values({
            id: 'insp-1', tenantId: TENANT_ID, email: 'insp1@x.com',
            passwordHash: 'h', role: 'inspector', name: 'Solo',
            createdAt: new Date(),
        });
        // Hours ARE configured on every Friday — so "not open" can only be about
        // the timezone, never about an empty availability table.
        await db.insert(availability).values({
            id: 'av-1', tenantId: TENANT_ID, inspectorId: 'insp-1',
            dayOfWeek: 5, startTime: '08:00', endTime: '12:00', createdAt: new Date(),
        });
    });

    afterEach(() => sqlite.close());

    /** The tenant's stored zone. `undefined` leaves the column at its NOT NULL
     *  default, which is exactly the never-configured state in production. */
    async function withStoredZone(zone?: string) {
        await db.insert(tenantConfigs).values({
            tenantId: TENANT_ID,
            updatedAt: new Date(),
            ...(zone === undefined ? {} : { defaultTimezone: zone }),
        });
    }

    function buildApp() {
        const app = new OpenAPIHono<HonoConfig>();
        app.onError((err, c) => {
            if (err instanceof AppError) {
                return c.json(
                    { success: false, error: { code: err.code, message: err.message, details: err.details } },
                    err.status as 400,
                );
            }
            return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
        });
        app.use('*', async (c, next) => {
            c.set('services', {
                booking: svc,
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
                contact: {
                    upsertClientContact: vi.fn().mockResolvedValue({ id: 'c1' }),
                },
            } as unknown as HonoConfig['Variables']['services']);
            await next();
        });
        app.route('/', bookingsRoutes);
        return app;
    }

    function book(date: string) {
        return buildApp().request('/book', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tenant: TENANT_SLUG,
                address: '123 Main St, City, ST 12345',
                clientName: 'Client',
                clientEmail: 'c@example.com',
                date,
                timeSlot: 'morning', // -> requestedTime 08:00
            }),
        }, FAKE_ENV, FAKE_EXEC_CTX);
    }

    it('refuses the booking, and writes nothing, when the column is still at its default', async () => {
        await withStoredZone(); // never configured
        const res = await book(FRI_BEFORE_FALL_BACK);

        expect(res.status).toBe(409);
        const body = await res.json() as { error?: { message?: string } };
        expect(body.error?.message).toMatch(/not open yet/i);

        // THE DISCRIMINATING ASSERTION. A status check alone would still pass if
        // the refusal happened after the rows were written; what makes this a
        // refusal rather than a rollback is that nothing was ever inserted. With
        // the fix reverted this row exists and carries 08:00Z.
        const rows = await db.select().from(inspections)
            .where(eq(inspections.tenantId, TENANT_ID)).all();
        expect(rows).toHaveLength(0);
    });

    it('refuses a stored value that is not a real zone, the same way', async () => {
        // CHARACTERISATION, not a discriminator: `isValidTimeZone` already
        // rejected abbreviations before the sentinel rule existed, so this case
        // stays green with the sentinel removed. It is here to pin that the new
        // refusal did not narrow the old one — both "never chose" and "chose
        // something that is not a zone" have to land in the same place.
        await withStoredZone('Pacific Time');
        const res = await book(FRI_BEFORE_FALL_BACK);
        expect(res.status).toBe(409);
        expect(await db.select().from(inspections)
            .where(eq(inspections.tenantId, TENANT_ID)).all()).toHaveLength(0);
    });

    it('books normally for a workspace that DECLARED UTC as Etc/UTC', async () => {
        // The positive control. The gate tests "did a human choose a zone", not
        // "is the zone UTC" — a workspace really operating in UTC must still be
        // able to sell an appointment, and its 08:00 must still be 08:00Z.
        await withStoredZone('Etc/UTC');
        const res = await book(FRI_BEFORE_FALL_BACK);
        expect(res.status).toBe(200);

        const row = await db.select().from(inspections)
            .where(eq(inspections.tenantId, TENANT_ID)).get();
        expect(row?.scheduledStartMs?.getTime())
            .toBe(Date.UTC(2026, 9, 30, 8, 0, 0));
    });

    describe('the stamped instant across both DST transitions', () => {
        /** Eastern offsets either side of a transition, asserted as absolute
         *  epoch ms so a wrong answer cannot be read as a formatting choice. */
        const cases: Array<{ date: string; utcHour: number; note: string }> = [
            { date: FRI_BEFORE_FALL_BACK, utcHour: 12, note: 'EDT, -04:00' },
            { date: FRI_AFTER_FALL_BACK, utcHour: 13, note: 'EST, -05:00' },
            { date: FRI_BEFORE_SPRING_FWD, utcHour: 13, note: 'EST, -05:00' },
            { date: FRI_AFTER_SPRING_FWD, utcHour: 12, note: 'EDT, -04:00' },
        ];

        for (const { date, utcHour, note } of cases) {
            it(`reads 08:00 on ${date} as ${String(utcHour).padStart(2, '0')}:00Z (${note})`, async () => {
                await withStoredZone(EASTERN);
                const res = await book(date);
                expect(res.status).toBe(200);

                const row = await db.select().from(inspections)
                    .where(eq(inspections.tenantId, TENANT_ID)).get();
                const [y, mo, d] = date.split('-').map(Number);
                // Both sides spelled out independently: the helper under test on
                // one side, a hand-computed UTC instant on the other, so a bug in
                // the helper cannot define its own expectation.
                expect(row?.scheduledStartMs?.getTime())
                    .toBe(Date.UTC(y as number, (mo as number) - 1, d as number, utcHour, 0, 0));
                expect(row?.scheduledStartMs?.getTime())
                    .toBe(wallClockToEpochMs(date, '08:00', EASTERN));
            });
        }
    });
});
