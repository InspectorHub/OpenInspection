import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { createTestDb, setupSchema } from './db';
import { tenants, users, services, serviceInspectors } from '../../server/lib/db/schema';
import type { HonoConfig } from '../../server/types/hono';
import type { UserRole } from '../../server/types/auth';
import { AppError } from '../../server/lib/errors';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../server/lib/db/schema';

/**
 * Task 11 (Track G) — per-service inspector qualification write face.
 *
 * GET /:id/inspectors  → { success, data: { userIds: string[] } }
 * PUT /:id/inspectors  → full replace; empty array = all-qualified (no rows).
 * 404 for foreign-tenant service; 400 for foreign/agent userId.
 *
 * Also: BookingService.getQualifiedInspectorIds proof that the write face
 * feeds the read face.
 */

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// Import AFTER mock is set up.
// eslint-disable-next-line import/order
import { servicesRoutes } from '../../server/api/services';
// eslint-disable-next-line import/order
import { BookingService } from '../../server/services/booking.service';
// eslint-disable-next-line import/order
import { ServiceService } from '../../server/services/service.service';

const T1 = 'aaaaaaaa-0000-0000-0000-000000000001';
const T2 = 'bbbbbbbb-0000-0000-0000-000000000002';
const S1 = 'ssssssss-0000-0000-0000-000000000001';
const U1 = 'uuuuuuuu-0000-0000-0000-000000000001';
const U2 = 'uuuuuuuu-0000-0000-0000-000000000002';
const U_AGENT = 'uuuuuuuu-0000-0000-0000-000000000099';
const S_FOREIGN = 'ssssssss-1111-0000-0000-000000000001'; // belongs to T2

const FAKE_ENV = { DB: {} } as HonoConfig['Bindings'];

function buildApp(
    db: BetterSQLite3Database<typeof schema>,
    { role = 'owner' as UserRole, tenantId = T1 } = {},
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

    // Provide a real ServiceService backed by the test DB so route handlers
    // can call c.var.services.service.getServiceInspectors / setServiceInspectors.
    const serviceService = new ServiceService(FAKE_ENV.DB as D1Database);

    app.use('*', async (c, next) => {
        c.set('tenantId', tenantId);
        c.set('user', { sub: 'caller', role, tenantId });
        c.set('userRole', role);
        c.set('services', { service: serviceService } as unknown as HonoConfig['Variables']['services']);
        await next();
    });

    app.route('/', servicesRoutes);
    (mockDrizzle as any).mockReturnValue(db);
    return app;
}

describe('GET / PUT /:id/inspectors (Task 11, Track G)', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: any;

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db as BetterSQLite3Database<typeof schema>;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as any).mockReturnValue(db);

        // Seed tenant T1 and tenant T2.
        await db.insert(tenants).values([
            { id: T1, name: 'Acme', slug: 'acme', tier: 'free', status: 'active', maxUsers: 10, deploymentMode: 'shared', createdAt: new Date() },
            { id: T2, name: 'Other Co', slug: 'other-co', tier: 'free', status: 'active', maxUsers: 10, deploymentMode: 'shared', createdAt: new Date() },
        ] as any);

        // Seed users: U1 and U2 are inspectors in T1; U_AGENT is agent in T1.
        await db.insert(users).values([
            { id: U1, tenantId: T1, email: 'u1@x.com', passwordHash: 'h', role: 'inspector', createdAt: new Date() },
            { id: U2, tenantId: T1, email: 'u2@x.com', passwordHash: 'h', role: 'inspector', createdAt: new Date() },
            { id: U_AGENT, tenantId: T1, email: 'agent@x.com', passwordHash: 'h', role: 'agent', createdAt: new Date() },
        ] as any);

        // Seed service S1 in T1, and S_FOREIGN in T2.
        await db.insert(services).values([
            { id: S1, tenantId: T1, name: 'Standard', price: 40000, active: true, createdAt: new Date(), sortOrder: 0 },
            { id: S_FOREIGN, tenantId: T2, name: 'Other Service', price: 10000, active: true, createdAt: new Date(), sortOrder: 0 },
        ] as any);
    });

    afterEach(() => sqlite.close());

    // ----------------------------------------------------------------
    // GET /:id/inspectors
    // ----------------------------------------------------------------

    it('GET returns empty userIds when no restriction rows exist', async () => {
        const app = buildApp(db);
        const res = await app.request(`/${S1}/inspectors`, {}, FAKE_ENV);
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.success).toBe(true);
        expect(body.data.userIds).toEqual([]);
    });

    it('GET returns existing restriction userIds', async () => {
        await db.insert(serviceInspectors).values([
            { serviceId: S1, userId: U1, tenantId: T1, createdAt: new Date() },
            { serviceId: S1, userId: U2, tenantId: T1, createdAt: new Date() },
        ] as any);
        const app = buildApp(db);
        const res = await app.request(`/${S1}/inspectors`, {}, FAKE_ENV);
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.data.userIds).toHaveLength(2);
        expect(body.data.userIds).toContain(U1);
        expect(body.data.userIds).toContain(U2);
    });

    it('GET returns 404 for a service that belongs to a different tenant', async () => {
        const app = buildApp(db); // caller is in T1
        const res = await app.request(`/${S_FOREIGN}/inspectors`, {}, FAKE_ENV);
        expect(res.status).toBe(404);
    });

    // ----------------------------------------------------------------
    // PUT /:id/inspectors — round-trip
    // ----------------------------------------------------------------

    it('PUT two userIds then GET reads both back', async () => {
        const app = buildApp(db);

        const putRes = await app.request(`/${S1}/inspectors`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userIds: [U1, U2] }),
        }, FAKE_ENV);
        expect(putRes.status).toBe(200);
        const putBody = await putRes.json() as any;
        expect(putBody.success).toBe(true);
        expect(putBody.data.count).toBe(2);

        const getRes = await app.request(`/${S1}/inspectors`, {}, FAKE_ENV);
        const getBody = await getRes.json() as any;
        expect(getBody.data.userIds).toHaveLength(2);
        expect(getBody.data.userIds).toContain(U1);
        expect(getBody.data.userIds).toContain(U2);
    });

    it('PUT [] clears restrictions and GET reads empty list (back to all-qualified)', async () => {
        // First restrict, then clear.
        const app = buildApp(db);

        await app.request(`/${S1}/inspectors`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userIds: [U1] }),
        }, FAKE_ENV);

        const clearRes = await app.request(`/${S1}/inspectors`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userIds: [] }),
        }, FAKE_ENV);
        expect(clearRes.status).toBe(200);
        const clearBody = await clearRes.json() as any;
        expect(clearBody.data.count).toBe(0);

        const getRes = await app.request(`/${S1}/inspectors`, {}, FAKE_ENV);
        const getBody = await getRes.json() as any;
        expect(getBody.data.userIds).toEqual([]);
    });

    // ----------------------------------------------------------------
    // PUT error cases
    // ----------------------------------------------------------------

    it('PUT on a foreign-tenant service returns 404', async () => {
        const app = buildApp(db); // caller is in T1
        const res = await app.request(`/${S_FOREIGN}/inspectors`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userIds: [] }),
        }, FAKE_ENV);
        expect(res.status).toBe(404);
    });

    it('PUT with a userId that does not exist in the tenant returns 400', async () => {
        const app = buildApp(db);
        const res = await app.request(`/${S1}/inspectors`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userIds: ['no-such-user'] }),
        }, FAKE_ENV);
        expect(res.status).toBe(400);
        const body = await res.json() as any;
        expect(body.error.code).toBe('bad_request');
    });

    it('PUT with an agent-role userId returns 400', async () => {
        const app = buildApp(db);
        const res = await app.request(`/${S1}/inspectors`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userIds: [U_AGENT] }),
        }, FAKE_ENV);
        expect(res.status).toBe(400);
        const body = await res.json() as any;
        expect(body.error.code).toBe('bad_request');
    });

    // ----------------------------------------------------------------
    // Dedup: duplicate userIds are silently collapsed
    // ----------------------------------------------------------------

    it('PUT with duplicate userIds succeeds and GET returns deduplicated set', async () => {
        const app = buildApp(db);

        // Send U1 twice in the same request.
        const putRes = await app.request(`/${S1}/inspectors`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userIds: [U1, U1, U2, U1] }),
        }, FAKE_ENV);
        expect(putRes.status).toBe(200);
        const putBody = await putRes.json() as any;
        expect(putBody.success).toBe(true);
        // After dedup: [U1, U2] → count = 2, not 4.
        expect(putBody.data.count).toBe(2);

        const getRes = await app.request(`/${S1}/inspectors`, {}, FAKE_ENV);
        const getBody = await getRes.json() as any;
        expect(getBody.data.userIds).toHaveLength(2);
        expect(getBody.data.userIds).toContain(U1);
        expect(getBody.data.userIds).toContain(U2);
    });

    // ----------------------------------------------------------------
    // Integration: write face feeds BookingService read face
    // ----------------------------------------------------------------

    it('after PUT restricting S1 to U2, BookingService.getQualifiedInspectorIds returns only U2', async () => {
        const app = buildApp(db);

        // Restrict S1 to U2 only.
        await app.request(`/${S1}/inspectors`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userIds: [U2] }),
        }, FAKE_ENV);

        // BookingService reads directly from the same DB.
        const bookingService = new BookingService(FAKE_ENV.DB as D1Database);
        (mockDrizzle as any).mockReturnValue(db);
        const qualified = await bookingService.getQualifiedInspectorIds(T1, [S1]);
        expect(qualified).toEqual([U2]);
        expect(qualified).not.toContain(U1);
    });
});
