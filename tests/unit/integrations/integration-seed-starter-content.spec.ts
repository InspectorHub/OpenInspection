/**
 * Trial Sample-Data Mode (2026-05-20 spec) —
 *   POST /api/integration/seed-starter-content integration tests.
 *
 * The seed endpoint was migrated from the core admin router (`/api/admin/*`)
 * to the portal integration seam (`server/portal/integration.routes.ts`,
 * mounted at `/api/integration/*`). This mounts the real integration routes on
 * a fresh OpenAPIHono so we exercise the actual middleware chain (the
 * `requireServiceBinding` M2M guard + the route handler). `drizzle-orm/d1` is
 * mocked to a better-sqlite3 instance so existence checks + seed inserts hit a
 * real-ish DB.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { HonoConfig } from '../../../server/types/hono';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import integrationRoutes from '../../../server/portal/integration.routes';
import { signM2mHeader, M2M_HEADER } from '../../../server/lib/m2m-auth';

// Portal→core M2M auth is the `x-portal-m2m` HMAC derived (via HKDF) from the
// shared JWT_PRIVATE_KEY_V<N> — NOT the old non-existent `cf-worker` header.
// Any base64 PEM body works as HKDF input keying material; sign + verify use
// the same env so the derived HMAC key matches.
const FAKE_PEM = `-----BEGIN PRIVATE KEY-----\n${btoa('test-m2m-shared-key-material-0123456789')}\n-----END PRIVATE KEY-----`;
const M2M_ENV = { DB: {}, JWT_CURRENT_KID: 'v1', JWT_PRIVATE_KEY_V1: FAKE_PEM } as Record<string, unknown>;

describe('POST /api/integration/seed-starter-content', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sqlite: any;
    const tenantId = '00000000-0000-0000-0000-000000000001';

    function buildApp() {
        const app = new OpenAPIHono<HonoConfig>();
        // Mirror registerPortalIntegration(app): app.route('/api/integration', integrationRoutes).
        app.route('/api/integration', integrationRoutes);
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
            slug: 'test',
            createdAt: new Date(),
        });
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    it('seeds starter content with a valid x-portal-m2m header (Service Binding)', async () => {
        const app = buildApp();
        const res = await app.request('/api/integration/seed-starter-content', {
            method: 'POST',
            headers: {
                'content-type':  'application/json',
                [M2M_HEADER]:    await signM2mHeader(M2M_ENV as Record<string, string | undefined>),
            },
            body: JSON.stringify({ tenantId }),
        }, M2M_ENV);

        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            success: boolean;
            data: { inspectionTemplatesSeeded: number; cannedCommentsSeeded: number };
        };
        expect(body.success).toBe(true);
        expect(body.data.inspectionTemplatesSeeded).toBe(7);
        expect(body.data.cannedCommentsSeeded).toBe(254);
    });

    it('returns 403 when the M2M header is missing', async () => {
        const app = buildApp();
        const res = await app.request('/api/integration/seed-starter-content', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ tenantId }),
        }, M2M_ENV);

        expect(res.status).toBe(403);
        const body = (await res.json()) as { success: boolean; error: { message: string } };
        expect(body.success).toBe(false);
        expect(body.error.message).toBe('Forbidden');
    });

    it('returns 404 for an unknown tenantId', async () => {
        const app = buildApp();
        const res = await app.request('/api/integration/seed-starter-content', {
            method: 'POST',
            headers: {
                'content-type':  'application/json',
                [M2M_HEADER]:    await signM2mHeader(M2M_ENV as Record<string, string | undefined>),
            },
            body: JSON.stringify({ tenantId: '00000000-0000-0000-0000-999999999999' }),
        }, M2M_ENV);

        expect(res.status).toBe(404);
        const body = (await res.json()) as { success: boolean; error: { message: string } };
        expect(body.success).toBe(false);
        expect(body.error.message).toBe('Tenant not found');
    });
});
