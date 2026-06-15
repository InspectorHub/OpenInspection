/**
 * Gate: POST /api/public/repair-request/email must return 403 when the
 * inspection's report_status is not 'published'.
 *
 * Harness pattern mirrors checkout-public.spec.ts / booking-contact-upsert.spec.ts:
 *   - vi.mock drizzle-orm/d1 so the handler's `drizzle(c.env.DB)` returns
 *     the in-memory better-sqlite3 DB.
 *   - Real seeded DB via createTestDb + setupSchema.
 *   - rate-limit mocked to no-op (no RATE_LIMITER binding needed).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';
import type { HonoConfig } from '../../server/types/hono';
import { AppError } from '../../server/lib/errors';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

// Must be declared BEFORE importing the routes module so the mock is active
// when the module is first evaluated.
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// Rate-limit is a pass-through in tests — no RATE_LIMITER binding required.
vi.mock('../../server/lib/rate-limit', () => ({
    checkRateLimit: vi.fn().mockResolvedValue(undefined),
}));

// Import routes AFTER mocks are registered.
// eslint-disable-next-line import/order
import repairRequestRoutes from '../../server/api/repair-requests';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const INSP_ID   = '550e8400-e29b-41d4-a716-446655440000';

const FAKE_ENV: HonoConfig['Bindings'] = {
    DB: {} as D1Database,
    APP_NAME: 'OpenInspection',
    APP_BASE_URL: 'https://example.test',
} as unknown as HonoConfig['Bindings'];

const FAKE_EXEC_CTX: ExecutionContext = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
};

function buildApp(db: BetterSQLite3Database<typeof schema>) {
    const app = new OpenAPIHono<HonoConfig>();

    // Map AppError → proper HTTP status so assertions on res.status work.
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json(
                { success: false, error: { code: err.code, message: err.message } },
                err.status,
            );
        }
        return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
    });

    app.use('*', async (c, next) => {
        // tenantId is pre-resolved; handler will use it and skip the DB lookup.
        c.set('tenantId', TENANT_ID);
        c.set('services', {
            email: { sendEmail: vi.fn().mockResolvedValue(undefined) },
        } as unknown as HonoConfig['Variables']['services']);
        await next();
    });

    app.route('/api/public', repairRequestRoutes);

    (mockDrizzle as ReturnType<typeof vi.fn>).mockReturnValue(db);

    return { app };
}

async function seedBase(
    db: BetterSQLite3Database<typeof schema>,
    inspOver: Partial<typeof schema.inspections.$inferInsert> = {},
) {
    await db.insert(schema.tenants).values({
        id: TENANT_ID, name: 'Acme', slug: 'acme', status: 'active',
        deploymentMode: 'shared', tier: 'free', maxUsers: 5, createdAt: new Date(),
    } as any);

    // enableCustomerRepairExport has a NOT NULL DEFAULT false — supply true to
    // pass the opt-in gate and let us reach the reportStatus gate.
    await db.insert(schema.tenantConfigs).values({
        tenantId: TENANT_ID,
        enableCustomerRepairExport: true,
        updatedAt: new Date(),
    } as any);

    await db.insert(schema.inspections).values({
        id: INSP_ID,
        tenantId: TENANT_ID,
        propertyAddress: '123 Oak St',
        clientName: 'Jane',
        clientEmail: 'jane@test.com',
        date: '2026-06-01',
        status: 'completed',
        reportStatus: 'in_progress',
        paymentRequired: false,
        paymentStatus: 'unpaid',
        agreementRequired: false,
        price: 50000,
        createdAt: new Date(),
        ...inspOver,
    } as any);
}

describe('POST /api/public/repair-request/email — reportStatus gate', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: any;

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db as BetterSQLite3Database<typeof schema>;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as ReturnType<typeof vi.fn>).mockReturnValue(db);
    });

    afterEach(() => {
        sqlite.close();
        vi.restoreAllMocks();
    });

    it('returns 403 when reportStatus is in_progress (not published)', async () => {
        await seedBase(db, { reportStatus: 'in_progress' });
        const { app } = buildApp(db);
        const res = await app.request(
            '/api/public/repair-request/email',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ inspectionId: INSP_ID, recipientEmail: 'buyer@x.com' }),
            },
            FAKE_ENV,
            FAKE_EXEC_CTX,
        );
        expect(res.status).toBe(403);
        const body = await res.json() as any;
        expect(body.success).toBe(false);
        expect(body.error.message).toMatch(/not published/i);
    });

    it('returns 403 when reportStatus is submitted (not published)', async () => {
        await seedBase(db, { reportStatus: 'submitted' });
        const { app } = buildApp(db);
        const res = await app.request(
            '/api/public/repair-request/email',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ inspectionId: INSP_ID, recipientEmail: 'buyer@x.com' }),
            },
            FAKE_ENV,
            FAKE_EXEC_CTX,
        );
        expect(res.status).toBe(403);
    });
});
