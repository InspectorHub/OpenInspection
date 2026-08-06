/**
 * Retry safety for the inspection service-line write surface (IA-87).
 *
 * These three routes decide what the client is BILLED, and until the
 * idempotency gate learned to read inline `.openapi(createRoute({…}))`
 * registrations they were in no list at all — not pending, not verified, not
 * by-design. They were invisible, which is worse than uncovered.
 *
 *   - POST /{id}/services is the one that moves money forward. The service
 *     layer already treats a re-add of the same catalog service as a no-op that
 *     returns the existing line, so the row count is safe on its own; what the
 *     guard adds is that the RESPONSE is the original one, replay-flagged,
 *     rather than a second 201 the caller cannot tell apart from a real add.
 *   - PATCH /{id}/services/{lineId} writes an ABSOLUTE override, not a delta,
 *     so it survives a replay by construction. Asserted as characterization and
 *     labelled as such: the day someone turns it into a delta, this is the
 *     assertion that should be rewritten loudly rather than deleted quietly.
 *   - DELETE /{id}/services/{lineId} is the one with a real hazard. Removal is
 *     a soft delete and the second call throws NotFound, so UNGUARDED a retry
 *     turns a successful removal into a 404 the operator reads as "the line is
 *     still there". Guarded, the replay returns the original success.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { and, eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from '../../../server/lib/db/schema';
import { tenants, users, services, inspections, inspectionServices } from '../../../server/lib/db/schema';
import { ServiceService } from '../../../server/services/service.service';
import { idempotencyMiddleware } from '../../../server/lib/middleware/idempotency';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';
import { createTestDb, setupSchema } from '../db';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// eslint-disable-next-line import/order
import { inspectionsRoutes } from '../../../server/api/inspections';

const T = 't1';
const INSP = 'i1';
const SVC_SEWER = 'svc-sewer';
const LINE = 'line-home';
const MGR = 'mgr';
const FAKE_ENV = { DB: {} } as HonoConfig['Bindings'];
const CTX = { waitUntil: () => {}, passThroughOnException: () => {} } as never;

let db: DrizzleD1Database;

function buildApp() {
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        }
        return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
    });
    app.use('*', async (c, next) => {
        c.set('tenantId', T);
        c.set('userRole', 'manager');
        c.set('user', { sub: MGR, role: 'manager', tenantId: T });
        c.set('sdb', { getById: async () => ({ permissionOverrides: null }) } as unknown as HonoConfig['Variables']['sdb']);
        c.set('services', {
            service: new ServiceService({} as never),
        } as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    // The mounted shape: tenant on the context first, then the guard.
    app.use('*', idempotencyMiddleware({ getDb: () => db as never }));
    app.route('/api/inspections', inspectionsRoutes);
    return app;
}

function send(method: string, path: string, key: string | null, body?: unknown) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (key) headers['Idempotency-Key'] = key;
    return buildApp().fetch(
        new Request(`https://acme.example.com${path}`, {
            method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        }),
        FAKE_ENV as never, CTX,
    );
}

const lines = () => db.select().from(inspectionServices)
    .where(and(eq(inspectionServices.tenantId, T), eq(inspectionServices.inspectionId, INSP))).all();

beforeEach(async () => {
    const fixture = createTestDb();
    await setupSchema(fixture.sqlite);
    db = drizzle(fixture.sqlite, { schema }) as unknown as DrizzleD1Database;
    const now = new Date();

    await db.insert(tenants).values({
        id: T, name: 'Acme', slug: 'acme', tier: 'free', status: 'active',
        maxUsers: 5, deploymentMode: 'shared', createdAt: now,
    }).run();
    await db.insert(users).values({
        id: MGR, tenantId: T, email: 'mgr@acme.test', passwordHash: 'x',
        name: 'Mgr', role: 'manager', createdAt: now,
    }).run();
    await db.insert(services).values([
        { id: 'svc-home', tenantId: T, name: 'Home Inspection', price: 50000, createdAt: now },
        { id: SVC_SEWER, tenantId: T, name: 'Sewer Scope', price: 22500, createdAt: now },
    ]).run();
    await db.insert(inspections).values({
        id: INSP, tenantId: T, propertyAddress: '1 Oak St', date: '2026-08-01', createdAt: now,
    }).run();
    await db.insert(inspectionServices).values({
        id: LINE, tenantId: T, inspectionId: INSP, serviceId: 'svc-home',
        nameSnapshot: 'Home Inspection', priceSnapshot: 50000,
    }).run();
});

describe("POST '/api/inspections/{id}/services' — a replay must not bill a second line", () => {
    const add = (key: string | null) => send(
        'POST', `/api/inspections/${INSP}/services`, key, { serviceId: SVC_SEWER },
    );

    it('adds ONE line across two posts under one key', async () => {
        const first = await add('add-1');
        const second = await add('add-1');

        expect(first.status).toBe(201);
        expect(second.status).toBe(201);
        expect(await lines()).toHaveLength(2);
    });

    it('replays the original response, flagged', async () => {
        const first = await add('add-1');
        const second = await add('add-1');

        expect(await second.json()).toEqual(await first.clone().json());
        expect(second.headers.get('Idempotency-Replayed')).toBe('true');
        expect(first.headers.get('Idempotency-Replayed')).toBeNull();
    });

    it('a DELIBERATE second add under a fresh key still resolves to one line', async () => {
        // Not the guard: the service layer treats a re-add of the same catalog
        // service as a no-op returning the existing line. Stated so nobody
        // reads the previous test as the only thing holding the count at 2.
        await add('add-1');
        await add('add-2');
        expect(await lines()).toHaveLength(2);
    });
});

describe("PATCH '/api/inspections/{id}/services/{lineId}' — repricing one line", () => {
    it('CHARACTERIZATION: an absolute override survives a replay on its own', async () => {
        // Not evidence for the guard. The route writes a value, not a delta.
        const path = `/api/inspections/${INSP}/services/${LINE}`;
        await send('PATCH', path, 'price-1', { priceOverrideCents: 42000 });
        await send('PATCH', path, 'price-1', { priceOverrideCents: 42000 });

        const rows = (await lines()).filter(l => l.id === LINE);
        expect(rows).toHaveLength(1);
        expect(rows[0].priceOverride).toBe(42000);
    });

    it('replays the original response, flagged', async () => {
        const path = `/api/inspections/${INSP}/services/${LINE}`;
        const first = await send('PATCH', path, 'price-1', { priceOverrideCents: 42000 });
        const second = await send('PATCH', path, 'price-1', { priceOverrideCents: 42000 });

        expect(first.status).toBe(200);
        expect(await second.json()).toEqual(await first.clone().json());
        expect(second.headers.get('Idempotency-Replayed')).toBe('true');
    });
});

describe("DELETE '/api/inspections/{id}/services/{lineId}' — a replay must not report the line as still there", () => {
    const remove = (key: string | null) => send(
        'DELETE', `/api/inspections/${INSP}/services/${LINE}`, key,
    );

    it('the second call under one key returns the original success, not a 404', async () => {
        const first = await remove('rm-1');
        const second = await remove('rm-1');

        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        expect(await second.json()).toEqual(await first.clone().json());
        expect(second.headers.get('Idempotency-Replayed')).toBe('true');
    });

    it('the line is soft-deleted exactly once', async () => {
        await remove('rm-1');
        await remove('rm-1');

        const rows = (await lines()).filter(l => l.id === LINE);
        expect(rows).toHaveLength(1);
        expect(rows[0].active).toBe(false);
    });

    it('UNGUARDED, the retry turns a successful removal into a 404 — the hazard, stated', async () => {
        // No key: the guard cannot key on anything, and the operator's retry
        // reads as "that line is not there", which is indistinguishable from
        // "your removal did not take".
        expect((await remove(null)).status).toBe(200);
        expect((await remove(null)).status).toBe(404);
    });
});
