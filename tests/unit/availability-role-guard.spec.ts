import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { createTestDb, setupSchema } from './db';
import { tenants } from '../../server/lib/db/schema';
import type { HonoConfig } from '../../server/types/hono';
import type { UserRole } from '../../server/types/auth';
import { AppError } from '../../server/lib/errors';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../server/lib/db/schema';

/**
 * Regression test for IA-26 Fix 1 — read-side role guard on availability GETs.
 *
 * An 'inspector' caller must NOT be able to view another inspector's availability
 * or overrides via ?inspectorId=. Only admin/owner may do so.
 */

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// Import AFTER mock is set up.
// eslint-disable-next-line import/order
import { availabilityRoutes } from '../../server/api/availability';

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_SLUG = 'acme-test';
const CALLER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER_ID   = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const FAKE_ENV = {
    DB: {},
} as HonoConfig['Bindings'];

/**
 * Builds a minimal app that mounts availabilityRoutes and injects the
 * given user + role into context — mirrors the auth middleware contract.
 */
function buildApp(
    db: BetterSQLite3Database<typeof schema>,
    { sub, role }: { sub: string; role: UserRole },
) {
    const app = new OpenAPIHono<HonoConfig>();

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
        c.set('tenantId', TENANT_ID);
        c.set('user', { sub, role, tenantId: TENANT_ID });
        c.set('userRole', role);
        // Minimal services stub (availability handlers don't call services on GETs).
        c.set('services', {} as HonoConfig['Variables']['services']);
        await next();
    });

    app.route('/', availabilityRoutes);
    (mockDrizzle as any).mockReturnValue(db);
    return app;
}

describe('GET /availability — on-behalf-of read role guard (IA-26)', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: any;

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db as BetterSQLite3Database<typeof schema>;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as any).mockReturnValue(db);

        await db.insert(tenants).values({
            id: TENANT_ID, name: 'Acme Inspections', slug: TENANT_SLUG,
            tier: 'free', status: 'active', maxUsers: 5,
            deploymentMode: 'shared', createdAt: new Date(),
        } as any);
    });

    afterEach(() => sqlite.close());

    // -- Weekly schedule GET --

    it('inspector querying own id gets 200', async () => {
        const app = buildApp(db, { sub: CALLER_ID, role: 'inspector' });
        const res = await app.request(`/?inspectorId=${CALLER_ID}`, {}, FAKE_ENV);
        expect(res.status).toBe(200);
    });

    it('inspector omitting inspectorId (defaults to self) gets 200', async () => {
        const app = buildApp(db, { sub: CALLER_ID, role: 'inspector' });
        const res = await app.request('/', {}, FAKE_ENV);
        expect(res.status).toBe(200);
    });

    it('inspector querying a different inspectorId gets 403', async () => {
        const app = buildApp(db, { sub: CALLER_ID, role: 'inspector' });
        const res = await app.request(`/?inspectorId=${OTHER_ID}`, {}, FAKE_ENV);
        expect(res.status).toBe(403);
        const body = await res.json() as any;
        expect(body.error.code).toBe('forbidden');
    });

    it('admin querying a different inspectorId gets 200', async () => {
        const app = buildApp(db, { sub: CALLER_ID, role: 'admin' });
        const res = await app.request(`/?inspectorId=${OTHER_ID}`, {}, FAKE_ENV);
        expect(res.status).toBe(200);
    });

    it('owner querying a different inspectorId gets 200', async () => {
        const app = buildApp(db, { sub: CALLER_ID, role: 'owner' });
        const res = await app.request(`/?inspectorId=${OTHER_ID}`, {}, FAKE_ENV);
        expect(res.status).toBe(200);
    });
});

describe('GET /overrides — on-behalf-of read role guard (IA-26)', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: any;

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db as BetterSQLite3Database<typeof schema>;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as any).mockReturnValue(db);

        await db.insert(tenants).values({
            id: TENANT_ID, name: 'Acme Inspections', slug: TENANT_SLUG,
            tier: 'free', status: 'active', maxUsers: 5,
            deploymentMode: 'shared', createdAt: new Date(),
        } as any);
    });

    afterEach(() => sqlite.close());

    it('inspector querying own id gets 200', async () => {
        const app = buildApp(db, { sub: CALLER_ID, role: 'inspector' });
        const res = await app.request(`/overrides?inspectorId=${CALLER_ID}`, {}, FAKE_ENV);
        expect(res.status).toBe(200);
    });

    it('inspector omitting inspectorId (defaults to self) gets 200', async () => {
        const app = buildApp(db, { sub: CALLER_ID, role: 'inspector' });
        const res = await app.request('/overrides', {}, FAKE_ENV);
        expect(res.status).toBe(200);
    });

    it('inspector querying a different inspectorId gets 403', async () => {
        const app = buildApp(db, { sub: CALLER_ID, role: 'inspector' });
        const res = await app.request(`/overrides?inspectorId=${OTHER_ID}`, {}, FAKE_ENV);
        expect(res.status).toBe(403);
        const body = await res.json() as any;
        expect(body.error.code).toBe('forbidden');
    });

    it('admin querying a different inspectorId gets 200', async () => {
        const app = buildApp(db, { sub: CALLER_ID, role: 'admin' });
        const res = await app.request(`/overrides?inspectorId=${OTHER_ID}`, {}, FAKE_ENV);
        expect(res.status).toBe(200);
    });

    it('owner querying a different inspectorId gets 200', async () => {
        const app = buildApp(db, { sub: CALLER_ID, role: 'owner' });
        const res = await app.request(`/overrides?inspectorId=${OTHER_ID}`, {}, FAKE_ENV);
        expect(res.status).toBe(200);
    });
});
