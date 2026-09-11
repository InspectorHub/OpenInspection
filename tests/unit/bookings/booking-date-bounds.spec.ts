import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { createTestDb, setupSchema } from '../db';
import { BookingService } from '../../../server/services/booking.service';
import { tenants, users, availability, tenantConfigs } from '../../../server/lib/db/schema';
import type { HonoConfig } from '../../../server/types/hono';
import { AppError } from '../../../server/lib/errors';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import {
    PublicBookingSchema,
    bookingDateIsNotPast,
    bookingDateIsWithinHorizon,
    BOOKING_MAX_AHEAD_DAYS,
} from '../../../server/lib/validations/booking.schema';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// eslint-disable-next-line import/order
import { bookingsRoutes } from '../../../server/api/bookings';
import { makeExecutionContext } from '../helpers/exec-ctx';

vi.mock('../../../server/lib/rate-limit', () => ({
    checkRateLimit: vi.fn().mockResolvedValue(undefined),
}));

/**
 * F42 — a booking date that has already gone must be refused as a DATE problem.
 *
 * Measured on the public page: `2020-01-05` (Sunday, six years past) passed every
 * client check, reached the confirm step, and came back as
 *
 *   > That time slot is no longer available. Please pick another time.
 *
 * which is wrong three ways — it was never available rather than no longer, the
 * field at fault is the date and not the time, and the visitor is told neither.
 * Worse, that refusal only happened because nobody works Sundays: a past date on
 * a day the company DOES work had no rule against it at all, which is what the
 * Thursday case below pins.
 */
const TENANT_ID = 'aaaaaaaa-0000-0000-0000-0000000000d1';
const TENANT_SLUG = 'date-bounds';
/** 2020-01-02 and 2026-11-26 are both Thursdays — the one day this tenant works. */
const PAST_THURSDAY = '2020-01-02';
const FUTURE_THURSDAY = '2026-11-26';

const FAKE_ENV = { DB: {} } as HonoConfig['Bindings'];
const FAKE_EXEC_CTX = makeExecutionContext().ctx;

function validBody(date: string) {
    return {
        tenant: TENANT_SLUG,
        address: '123 Main St, City, ST 12345',
        clientName: 'Client',
        clientEmail: 'c@example.com',
        date,
        timeSlot: 'morning',
    };
}

describe('booking date bounds — the schema', () => {
    it('refuses a date in the past and names the date field', () => {
        const parsed = PublicBookingSchema.safeParse(validBody(PAST_THURSDAY));
        expect(parsed.success).toBe(false);
        const issue = parsed.success ? null : parsed.error.issues.find((i) => i.path[0] === 'date');
        expect(issue).toBeTruthy();
        expect(issue!.message).toMatch(/date has already passed/i);
        // The old wording must not be what a date problem produces.
        expect(issue!.message).not.toMatch(/time slot/i);
    });

    it('refuses a mistyped year far in the future', () => {
        const parsed = PublicBookingSchema.safeParse(validBody('2062-09-11'));
        expect(parsed.success).toBe(false);
    });

    // POSITIVE CONTROL: a schema that refused everything would pass the two above.
    it('accepts an ordinary future date', () => {
        expect(PublicBookingSchema.safeParse(validBody(FUTURE_THURSDAY)).success).toBe(true);
    });

    it('keeps one day of slack, because the company zone is unknown here', () => {
        // No zone is a full day from UTC (UTC-12 .. UTC+14), so yesterday-in-UTC
        // must stay acceptable: it can still be today for a real tenant. The
        // exact boundary belongs where the tenant zone is known.
        expect(bookingDateIsNotPast('2026-09-10', '2026-09-10')).toBe(true);
        expect(bookingDateIsNotPast('2026-09-09', '2026-09-10')).toBe(false);
        expect(bookingDateIsWithinHorizon('2026-09-10', '2027-09-10')).toBe(true);
        expect(bookingDateIsWithinHorizon('2027-09-11', '2027-09-10')).toBe(false);
        expect(BOOKING_MAX_AHEAD_DAYS).toBeGreaterThan(365);
    });
});

describe('booking date bounds — the public endpoint', () => {
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
            id: 'insp-d1', tenantId: TENANT_ID, email: 'insp@x.com',
            passwordHash: 'h', role: 'inspector', name: 'Solo',
            createdAt: new Date(),
        });
        // Thursdays, 08:00-10:00 — so both test dates fall on a working day and
        // the only thing separating them is that one of them has gone.
        await db.insert(availability).values({
            id: 'av-d1', tenantId: TENANT_ID, inspectorId: 'insp-d1',
            dayOfWeek: 4, startTime: '08:00', endTime: '10:00', createdAt: new Date(),
        });
        await db.insert(tenantConfigs).values({
            tenantId: TENANT_ID,
            updatedAt: new Date(),
            defaultTimezone: 'America/New_York',
        });
    });

    afterEach(() => sqlite.close());

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
                    create: vi.fn().mockResolvedValue({ id: 'req-d1', inspections: [{ id: 'insp-x' }] }),
                },
                contact: { upsertClientContact: vi.fn().mockResolvedValue({ id: 'c1' }) },
            } as unknown as HonoConfig['Variables']['services']);
            await next();
        });
        app.route('/', bookingsRoutes);
        return app;
    }

    function post(date: string) {
        return buildApp().request('/book', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(validBody(date)),
        }, FAKE_ENV, FAKE_EXEC_CTX);
    }

    it('refuses a past date on a day the company DOES work', async () => {
        const res = await post(PAST_THURSDAY);
        expect(res.status).toBe(400);
        // Whatever shape the validation error takes, the date must be named and
        // the time must not be blamed.
        const body = JSON.stringify(await res.json());
        expect(body).toMatch(/already passed/i);
        expect(body).not.toMatch(/time slot is no longer available/i);
    });

    // POSITIVE CONTROL: the same body on a future Thursday goes through, so the
    // rejection above is about the date and not about this fixture.
    it('accepts the same booking on a future Thursday', async () => {
        const res = await post(FUTURE_THURSDAY);
        expect(res.status).toBe(200);
    });
});
