/**
 * Default-template backfill — POST /api/integration/backfill-default-templates
 * signed-handshake tests.
 *
 * A one-shot M2M endpoint (no request body): it iterates every tenant and
 * bulk-seeds the default templates, swallowing per-tenant errors so the call
 * always reports `{ success: true }`. These tests mount the real integration
 * routes so the `requireServiceBinding` M2M guard + handler run for real, and
 * assert the guard contract (signed → 200, unsigned → 403).
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

const FAKE_PEM = `-----BEGIN PRIVATE KEY-----\n${btoa('test-m2m-shared-key-material-0123456789')}\n-----END PRIVATE KEY-----`;
const M2M_ENV = {
    DB:                 {},
    JWT_CURRENT_KID:    'v1',
    JWT_PRIVATE_KEY_V1: FAKE_PEM,
} as Record<string, unknown>;

describe('POST /api/integration/backfill-default-templates', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sqlite: any;

    function buildApp() {
        const app = new OpenAPIHono<HonoConfig>();
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
            id:        '00000000-0000-0000-0000-000000000001',
            name:      'Test Tenant',
            slug:      'test',
            createdAt: new Date(),
        });
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    it('runs the backfill with a valid x-portal-m2m header (Service Binding)', async () => {
        const app = buildApp();
        const res = await app.request('/api/integration/backfill-default-templates', {
            method: 'POST',
            headers: {
                'content-type':  'application/json',
                [M2M_HEADER]:    await signM2mHeader(M2M_ENV as Record<string, string | undefined>),
            },
        }, M2M_ENV);

        expect(res.status).toBe(200);
        const body = (await res.json()) as { success: boolean };
        expect(body.success).toBe(true);
    });

    it('returns 403 when the M2M header is missing', async () => {
        const app = buildApp();
        const res = await app.request('/api/integration/backfill-default-templates', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
        }, M2M_ENV);

        expect(res.status).toBe(403);
        const body = (await res.json()) as { success: boolean; error: { message: string } };
        expect(body.success).toBe(false);
        expect(body.error.message).toBe('Forbidden');
    });
});
