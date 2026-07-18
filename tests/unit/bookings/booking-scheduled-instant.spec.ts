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

vi.mock('../../../server/lib/rate-limit', () => ({
    checkRateLimit: vi.fn().mockResolvedValue(undefined),
}));

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-0000000000s1';
const TENANT_SLUG = 'scheduled-instant';
/** 2026-07-17 is a Friday (dayOfWeek 5); not a US federal holiday. */
const FRIDAY = '2026-07-17';
const TENANT_TZ = 'America/New_York';

const FAKE_ENV = { DB: {} } as HonoConfig['Bindings'];
const FAKE_EXEC_CTX = {
    waitUntil: (p: Promise<unknown>) => { void p.catch(() => {}); },
    passThroughOnException: () => {},
} as ExecutionContext;

describe('fulfillBooking sets the precise scheduled instant', () => {
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
            id: TENANT_ID, name: 'Instant Co', slug: TENANT_SLUG,
            tier: 'pro', status: 'active', maxUsers: 5,
            deploymentMode: 'shared', createdAt: new Date(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        await db.insert(users).values({
            id: 'insp-1', tenantId: TENANT_ID, email: 'insp1@x.com',
            passwordHash: 'h', role: 'inspector', name: 'Solo',
            createdAt: new Date(),
        });
        await db.insert(availability).values({
            id: 'av-1', tenantId: TENANT_ID, inspectorId: 'insp-1',
            dayOfWeek: 5, startTime: '08:00', endTime: '12:00', createdAt: new Date(),
        });
        // Tenant is in America/New_York; no holiday region so the Friday is bookable.
        await db.insert(tenantConfigs).values({
            tenantId: TENANT_ID,
            updatedAt: new Date(),
            defaultTimezone: TENANT_TZ,
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

    it('stores scheduled_start_ms in the tenant timezone, plus end + duration', async () => {
        const app = buildApp();
        // Legacy single-service path (no `services`) does a real inspection insert.
        const res = await app.request('/book', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tenant: TENANT_SLUG,
                address: '123 Main St, City, ST 12345',
                clientName: 'Client',
                clientEmail: 'c@example.com',
                date: FRIDAY,
                timeSlot: 'morning', // -> requestedTime 08:00
            }),
        }, FAKE_ENV, FAKE_EXEC_CTX);
        expect(res.status).toBe(200);

        const row = await db.select().from(inspections)
            .where(eq(inspections.tenantId, TENANT_ID)).get();
        expect(row).toBeTruthy();

        // 08:00 wall-clock in America/New_York (EDT, -04:00) is 12:00Z — NOT the
        // naive `${date}T08:00:00Z` the busy-check key still uses.
        const expectedStart = wallClockToEpochMs(FRIDAY, '08:00', TENANT_TZ);
        expect(row!.scheduledStartMs).toBeTruthy();
        expect(row!.scheduledStartMs!.getTime()).toBe(expectedStart);
        // Morning window duration (4h) when no service carries an explicit one.
        expect(row!.durationMin).toBe(240);
        expect(row!.scheduledEndMs!.getTime()).toBe(expectedStart + 240 * 60000);
        // date keeps its civil prefix (still the busy-check ISO key underneath).
        expect(String(row!.date).startsWith(FRIDAY)).toBe(true);
    });
});
