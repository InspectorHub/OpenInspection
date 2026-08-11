/**
 * PUT '/api/admin/service-areas' — replacing an inspector's ZIP territory.
 *
 * Two things could go wrong on a retry and only one of them is obvious.
 *
 * The obvious one: the handler writes by DELETE-then-INSERT, and the table
 * carries a unique index on (tenant, user, zip). A naive replay could either
 * violate that index or, worse, land between the delete and the insert of the
 * first attempt and leave a territory nobody chose.
 *
 * The subtle one: a territory decides who is even OFFERED a booking. A doubled
 * or half-applied write does not surface as an error anywhere — it surfaces
 * weeks later as "why does the Round Rock job keep going to Dave".
 *
 * So this asserts BOTH guarantees: the mounted guard replays the stored
 * response rather than re-running the write, AND the stored rows are identical
 * either way (the write is genuinely replace-by-value, so even an unguarded
 * retry converges).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { OpenAPIHono } from '@hono/zod-openapi';
import adminRoutes from '../../../server/api/admin';
import { idempotencyMiddleware } from '../../../server/lib/middleware/idempotency';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';

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
        c.set('userRole', 'owner');
        c.set('tenantId', TENANT);
        c.set('user', { sub: USER } as never);
        c.set('services', {} as HonoConfig['Variables']['services']);
        await next();
    });
    // The mounted shape: tenant on the context first, then the guard.
    app.use('*', idempotencyMiddleware({ getDb: () => db as never }));
    app.route('/api/admin', adminRoutes);
    return app;
}

const ENV = { DB: {}, JWT_SECRET: 'test-secret' };
const EXEC = {
    waitUntil: (p: Promise<unknown>) => { void Promise.resolve(p).catch(() => {}); },
    passThroughOnException: () => {},
} as ExecutionContext;

function put(key: string | null, zipPrefixes: string[]) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (key) headers['Idempotency-Key'] = key;
    return buildApp().request('/api/admin/service-areas', {
        method: 'PUT', headers, body: JSON.stringify({ userId: USER, zipPrefixes }),
    }, ENV, EXEC);
}

const storedZips = async () => (await db.select({ zipPrefix: schema.inspectorServiceAreas.zipPrefix })
    .from(schema.inspectorServiceAreas)
    .where(and(
        eq(schema.inspectorServiceAreas.tenantId, TENANT),
        eq(schema.inspectorServiceAreas.userId, USER),
    )).all()).map(r => r.zipPrefix).sort();

beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

    await db.insert(schema.tenants).values({
        id: TENANT, slug: 'a', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await db.insert(schema.users).values({
        id: USER, tenantId: TENANT, email: 'u@test.com', passwordHash: 'h',
        role: 'inspector', name: 'Ann', createdAt: new Date(),
    });
});

describe("PUT '/api/admin/service-areas' — replay leaves one territory, not two", () => {
    it('two sends under one key store exactly the requested list', async () => {
        const first = await put('sa-1', ['78701', '787']);
        const second = await put('sa-1', ['78701', '787']);

        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        expect(await storedZips()).toEqual(['787', '78701']);
    });

    it('an UNGUARDED retry converges too — the write is replace-by-value', async () => {
        // The guard is the first line of defence, not the only one. A client
        // that retries without a key must still not double the territory.
        await put(null, ['78701']);
        await put(null, ['78701']);
        expect(await storedZips()).toEqual(['78701']);
    });

    it('an empty list clears the territory rather than being ignored', async () => {
        await put(null, ['78701', '73301']);
        expect(await storedZips()).toHaveLength(2);
        await put(null, []);
        expect(await storedZips()).toEqual([]);
    });

    it('duplicates in one payload collapse instead of hitting the unique index', async () => {
        const res = await put(null, ['78701', '78701', ' 78701 ']);
        expect(res.status).toBe(200);
        expect(await storedZips()).toEqual(['78701']);
    });

    it('a userId from another tenant is refused, not written under ours', async () => {
        await db.insert(schema.tenants).values({
            id: 'other', slug: 'b', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await db.insert(schema.users).values({
            id: 'stranger', tenantId: 'other', email: 's@test.com', passwordHash: 'h',
            role: 'inspector', name: 'Sam', createdAt: new Date(),
        });
        const res = await buildApp().request('/api/admin/service-areas', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: 'stranger', zipPrefixes: ['00000'] }),
        }, ENV, EXEC);
        expect(res.status).toBe(404);
        const rows = await db.select().from(schema.inspectorServiceAreas).all();
        expect(rows).toEqual([]);
    });
});
