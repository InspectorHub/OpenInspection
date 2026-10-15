import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { HonoConfig } from '../../../server/types/hono';
import { AppError } from '../../../server/lib/errors';

/**
 * GET /api/public/availability/:inspectorId is anonymous. It used to serialize
 * the raw database rows, so the response carried the company's internal tenant
 * id, row ids, creation times and (for synced overrides) the external calendar
 * event id. The booking page needs only the time windows.
 */

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

vi.mock('../../../server/lib/rate-limit', () => ({
    checkRateLimit: vi.fn().mockResolvedValue(undefined),
}));

// eslint-disable-next-line import/order
import { bookingsRoutes } from '../../../server/api/bookings';
import { BookingService } from '../../../server/services/booking.service';

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-000000000077';
const SLUG = 'acme-availability';
const INSPECTOR = 'insp-avail-1';

let db: BetterSQLite3Database<typeof schema>;

function buildApp() {
    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        }
        return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
    });
    app.use('*', async (c, next) => {
        c.set('services', { booking: new BookingService({} as D1Database) } as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    app.route('/', bookingsRoutes);
    return app;
}

async function get(): Promise<{ status: number; body: { data: Record<string, unknown> } }> {
    const res = await buildApp().request(
        `/availability/${INSPECTOR}?tenant=${SLUG}&start=2026-07-01&end=2026-07-31`,
        {}, { DB: {} } as HonoConfig['Bindings'],
    );
    return { status: res.status, body: await res.json() as { data: Record<string, unknown> } };
}

describe('public availability exposes time windows only', () => {
    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db as BetterSQLite3Database<typeof schema>;
        await setupSchema(fixture.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
        await db.insert(schema.tenants).values({
            id: TENANT_ID, slug: SLUG, tier: 'free', status: 'active', maxUsers: 5,
            deploymentMode: 'shared', createdAt: new Date(),
        } as never);
        await db.insert(schema.users).values({
            id: INSPECTOR, tenantId: TENANT_ID, email: 'i@example.com', passwordHash: 'x', role: 'inspector', createdAt: new Date(),
        } as never);
        await db.insert(schema.availability).values({
            id: 'av-1', tenantId: TENANT_ID, inspectorId: INSPECTOR, dayOfWeek: 2,
            startTime: '09:00', endTime: '17:00', createdAt: new Date(),
        });
        await db.insert(schema.availabilityOverrides).values({
            id: 'ov-1', tenantId: TENANT_ID, inspectorId: INSPECTOR, date: '2026-07-10',
            isAvailable: false, startTime: null, endTime: null, createdAt: new Date(),
            source: 'google', externalId: 'google-event-secret-id',
        });
    });

    it('returns the windows and nothing that identifies the company or a row', async () => {
        const { status, body } = await get();
        expect(status).toBe(200);
        // Positive control: the data a booking page needs is still there.
        expect(body.data.baseAvailability).toEqual([{ dayOfWeek: 2, startTime: '09:00', endTime: '17:00' }]);
        expect(body.data.overrides).toEqual([{ date: '2026-07-10', isAvailable: false, startTime: null, endTime: null }]);
        // The company's internal id and the external event id appear nowhere.
        const text = JSON.stringify(body);
        expect(text).not.toContain(TENANT_ID);
        expect(text).not.toContain('google-event-secret-id');
        expect(text).not.toContain('av-1');
        expect(text).not.toContain('createdAt');
    });
});
