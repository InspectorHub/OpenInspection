/**
 * Trial Sample-Data Mode (2026-05-20 spec) —
 *   POST /api/admin/seed-starter-content integration tests.
 *
 * Mounts the real `adminRoutes` on a fresh OpenAPIHono so we exercise the
 * actual middleware chain (verifyM2mAuth via Bearer token + the route
 * handler). `drizzle-orm/d1` is mocked to a better-sqlite3 instance so
 * existence checks + seed inserts hit a real-ish DB.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../src/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { HonoConfig } from '../../../src/types/hono';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import adminRoutes from '../../../src/api/admin';

describe('POST /api/admin/seed-starter-content', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sqlite: any;
    const tenantId = '00000000-0000-0000-0000-000000000001';
    const M2M_SECRET = 'test-m2m-secret-v1';

    function buildApp() {
        const app = new OpenAPIHono<HonoConfig>();
        app.route('/api/admin', adminRoutes);
        // Mirror src/index.ts global error handler: AppError carries `status`
        // (not `statusCode`); everything else is a 500.
        app.onError((err: unknown, c) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const e = err as any;
            if (e && typeof e.status === 'number') {
                return c.json({ success: false, error: { message: e.message ?? 'error' } }, e.status);
            }
            return c.json({ success: false, error: { message: 'Internal error' } }, 500);
        });
        return app;
    }

    beforeEach(async () => {
        const setup = createTestDb();
        testDb = setup.db;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);

        await testDb.insert(schema.tenants).values({
            id:        tenantId,
            name:      'Test Tenant',
            subdomain: 'test',
            createdAt: new Date(),
        });
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    it('seeds starter content with valid Bearer M2M auth', async () => {
        const app = buildApp();
        const res = await app.request('/api/admin/seed-starter-content', {
            method: 'POST',
            headers: {
                'content-type':  'application/json',
                'authorization': `Bearer ${M2M_SECRET}`,
            },
            body: JSON.stringify({ tenantId }),
        }, { PORTAL_M2M_SECRET_V1: M2M_SECRET, DB: {} } as Record<string, unknown>);

        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            success: boolean;
            data: { inspectionTemplatesSeeded: number; cannedCommentsSeeded: number };
        };
        expect(body.success).toBe(true);
        expect(body.data.inspectionTemplatesSeeded).toBe(7);
        expect(body.data.cannedCommentsSeeded).toBe(250);
    });

    it('returns 401 when Authorization header is missing', async () => {
        const app = buildApp();
        const res = await app.request('/api/admin/seed-starter-content', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ tenantId }),
        }, { PORTAL_M2M_SECRET_V1: M2M_SECRET, DB: {} } as Record<string, unknown>);

        expect(res.status).toBe(401);
    });

    it('returns 401 when Bearer token does not match any configured secret', async () => {
        const app = buildApp();
        const res = await app.request('/api/admin/seed-starter-content', {
            method: 'POST',
            headers: {
                'content-type':  'application/json',
                'authorization': 'Bearer wrong-secret',
            },
            body: JSON.stringify({ tenantId }),
        }, { PORTAL_M2M_SECRET_V1: M2M_SECRET, DB: {} } as Record<string, unknown>);

        expect(res.status).toBe(401);
    });

    it('returns 404 for an unknown tenantId', async () => {
        const app = buildApp();
        const res = await app.request('/api/admin/seed-starter-content', {
            method: 'POST',
            headers: {
                'content-type':  'application/json',
                'authorization': `Bearer ${M2M_SECRET}`,
            },
            body: JSON.stringify({ tenantId: '00000000-0000-0000-0000-999999999999' }),
        }, { PORTAL_M2M_SECRET_V1: M2M_SECRET, DB: {} } as Record<string, unknown>);

        expect(res.status).toBe(404);
    });
});
