import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { createTestDb, setupSchema } from '../db';
import { BookingService } from '../../../server/services/booking.service';
import {
    tenants,
    users,
    availability,
    tenantConfigs,
} from '../../../server/lib/db/schema';
import type { HonoConfig } from '../../../server/types/hono';
import { AppError } from '../../../server/lib/errors';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// eslint-disable-next-line import/order
import { bookingsRoutes } from '../../../server/api/bookings';

vi.mock('../../../server/lib/rate-limit', () => ({
    checkRateLimit: vi.fn().mockResolvedValue(undefined),
}));

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-0000000000h1';
const TENANT_SLUG = 'holiday-fulfill';
/** Thanksgiving 2026 — Thursday. */
const THANKSGIVING = '2026-11-26';

const FAKE_ENV = { DB: {} } as HonoConfig['Bindings'];
const FAKE_EXEC_CTX = {
    waitUntil: (p: Promise<unknown>) => { void p.catch(() => {}); },
    passThroughOnException: () => {},
} as ExecutionContext;

describe('fulfillBooking holiday block', () => {
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
            id: TENANT_ID, name: 'Holiday Co', slug: TENANT_SLUG,
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
            dayOfWeek: 4, startTime: '08:00', endTime: '10:00', createdAt: new Date(),
        });
        await db.insert(tenantConfigs).values({
            tenantId: TENANT_ID,
            updatedAt: new Date(),
            holidayRegion: 'US',
            holidayPublicPolicy: 'block',
            holidayInternalPolicy: 'advisory',
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

    it('returns 400 when public policy is block and date is in the catalog', async () => {
        const app = buildApp();
        const res = await app.request('/book', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tenant: TENANT_SLUG,
                address: '123 Main St, City, ST 12345',
                clientName: 'Client',
                clientEmail: 'c@example.com',
                date: THANKSGIVING,
                timeSlot: 'morning',
            }),
        }, FAKE_ENV, FAKE_EXEC_CTX);

        expect(res.status).toBe(400);
        const body = await res.json() as { error: { message: string; details?: unknown } };
        expect(body.error.message).toMatch(/closed|Thanksgiving/i);
    });

    it('allows booking when public policy is open on the same holiday', async () => {
        await db.update(tenantConfigs).set({ holidayPublicPolicy: 'open' });
        const app = buildApp();
        const res = await app.request('/book', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tenant: TENANT_SLUG,
                address: '123 Main St, City, ST 12345',
                clientName: 'Client',
                clientEmail: 'c@example.com',
                date: THANKSGIVING,
                timeSlot: 'morning',
            }),
        }, FAKE_ENV, FAKE_EXEC_CTX);

        expect(res.status).toBe(200);
    });
});
