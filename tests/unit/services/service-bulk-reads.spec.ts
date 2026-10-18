/**
 * Bulk reads for Settings -> Services: the qualified inspectors and the pay
 * rules of MANY services in one request each, instead of one request per
 * service.
 *
 * The contract is equivalence: for every service the caller owns, the bulk
 * answer is exactly what the per-service endpoint returns. Beyond that: a
 * service of another tenant never appears (and its rows never leak), the number
 * of database statements does not grow with the number of services, and the
 * same role and capability gates apply as on the per-service routes.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from '../../../server/lib/db/schema';
import { tenants, users, services, serviceInspectors, servicePayRules } from '../../../server/lib/db/schema';
import { ServiceService } from '../../../server/services/service.service';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';
import { createTestDb, setupSchema } from '../db';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
// eslint-disable-next-line import/order
import { servicesRoutes } from '../../../server/api/services';

const T = 't1';
const OTHER = 't2';
const FAKE_ENV = { DB: {} } as HonoConfig['Bindings'];

let db: DrizzleD1Database;
let selects = 0;

function buildApp(role: 'owner' | 'manager' | 'inspector' = 'manager') {
    const counting = new Proxy(db as object, {
        get(target, prop, receiver) {
            if (prop === 'select') {
                return (...a: unknown[]) => {
                    selects += 1;
                    return (target as { select: (...x: unknown[]) => unknown }).select(...a);
                };
            }
            return Reflect.get(target, prop, receiver);
        },
    }) as DrizzleD1Database;
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(counting);
    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        }
        return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
    });
    app.use('*', async (c, next) => {
        c.set('tenantId', T);
        c.set('userRole', role);
        c.set('user', { sub: 'mgr', role, tenantId: T });
        c.set('sdb', { getById: async () => ({ permissionOverrides: null }) } as unknown as HonoConfig['Variables']['sdb']);
        c.set('services', { service: new ServiceService({} as D1Database) } as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    app.route('/', servicesRoutes);
    return app;
}

const get = (app: OpenAPIHono<HonoConfig>, path: string) => app.request(path, {}, FAKE_ENV);
const json = async (res: Response) => (await res.json()) as { success: boolean; data: Record<string, unknown> };

beforeEach(async () => {
    const fixture = createTestDb();
    db = drizzle(fixture.sqlite, { schema }) as unknown as DrizzleD1Database;
    await setupSchema(fixture.sqlite);
    selects = 0;
    const now = new Date();
    await db.insert(tenants).values([
        { id: T, slug: 'a', tier: 'free', status: 'active', maxUsers: 10, deploymentMode: 'shared', createdAt: now },
        { id: OTHER, slug: 'b', tier: 'free', status: 'active', maxUsers: 10, deploymentMode: 'shared', createdAt: now },
    ] as never);
    await db.insert(users).values([
        { id: 'u1', tenantId: T, email: 'u1@x.com', passwordHash: 'h', role: 'inspector', createdAt: now },
        { id: 'u2', tenantId: T, email: 'u2@x.com', passwordHash: 'h', role: 'inspector', createdAt: now },
        { id: 'x1', tenantId: OTHER, email: 'x1@x.com', passwordHash: 'h', role: 'inspector', createdAt: now },
    ] as never);
    const mk = (id: string, tenantId: string) => ({ id, tenantId, name: id, price: 100, active: true, createdAt: now, sortOrder: 0 });
    await db.insert(services).values([mk('s1', T), mk('s2', T), mk('s3', T), mk('foreign', OTHER)] as never);
    await db.insert(serviceInspectors).values([
        { serviceId: 's1', userId: 'u1', tenantId: T, createdAt: now },
        { serviceId: 's1', userId: 'u2', tenantId: T, createdAt: now },
        { serviceId: 's2', userId: 'u2', tenantId: T, createdAt: now },
        { serviceId: 'foreign', userId: 'x1', tenantId: OTHER, createdAt: now },
    ] as never);
    await db.insert(servicePayRules).values([
        { id: 'r1', tenantId: T, serviceId: 's1', userId: null, type: 'percent', value: 5000, deductionCents: null, createdAt: now },
        { id: 'r2', tenantId: T, serviceId: 's1', userId: 'u1', type: 'fixed', value: 7500, deductionCents: null, createdAt: now },
        { id: 'r3', tenantId: T, serviceId: 's3', userId: null, type: 'percent_after_deduction', value: 4000, deductionCents: 500, createdAt: now },
        { id: 'r4', tenantId: OTHER, serviceId: 'foreign', userId: null, type: 'percent', value: 9999, deductionCents: null, createdAt: now },
    ] as never);
});

describe('GET /inspectors-by-service', () => {
    it('returns the qualified inspectors of every requested service, [] for an unrestricted one', async () => {
        const res = await get(buildApp(), '/inspectors-by-service?ids=s1,s2,s3');
        expect(res.status).toBe(200);
        const body = await json(res);
        expect(Object.keys(body.data).sort()).toEqual(['s1', 's2', 's3']);
        expect((body.data.s1 as string[]).sort()).toEqual(['u1', 'u2']);
        expect(body.data.s2).toEqual(['u2']);
        expect(body.data.s3).toEqual([]);
    });

    it('matches the per-service endpoint for every service', async () => {
        const app = buildApp();
        const bulk = (await json(await get(app, '/inspectors-by-service?ids=s1,s2,s3'))).data;
        for (const id of ['s1', 's2', 's3']) {
            const one = (await json(await get(app, `/${id}/inspectors`))).data as { userIds: string[] };
            expect([...(bulk[id] as string[])].sort()).toEqual([...one.userIds].sort());
        }
    });

    it('never returns another tenant\'s service or its rows', async () => {
        const body = await json(await get(buildApp(), '/inspectors-by-service?ids=s1,foreign'));
        expect(Object.keys(body.data)).toEqual(['s1']);
        expect(JSON.stringify(body)).not.toContain('x1');
    });

    it('omits an unknown id instead of failing the whole request', async () => {
        const body = await json(await get(buildApp(), '/inspectors-by-service?ids=s2,nope'));
        expect(Object.keys(body.data)).toEqual(['s2']);
    });

    it('answers an empty list with an empty map and no database work', async () => {
        const res = await get(buildApp(), '/inspectors-by-service?ids=');
        expect(res.status).toBe(200);
        expect((await json(res)).data).toEqual({});
        expect(selects).toBe(0);
    });

    it('statement count does not grow with the number of services', async () => {
        const few = buildApp();
        await get(few, '/inspectors-by-service?ids=s1');
        const one = selects;
        selects = 0;
        await get(few, '/inspectors-by-service?ids=s1,s2,s3,foreign,nope');
        expect(selects).toBe(one);
        expect(one).toBeLessThanOrEqual(2);
    });

    it('is refused to an inspector, like the per-service route', async () => {
        const res = await get(buildApp('inspector'), '/inspectors-by-service?ids=s1');
        expect(res.status).toBe(403);
    });

    it('refuses more ids than one request may carry', async () => {
        const ids = Array.from({ length: 101 }, (_, i) => `s${i}`).join(',');
        expect((await get(buildApp(), `/inspectors-by-service?ids=${ids}`)).status).toBe(400);
    });
});

describe('GET /pay-rules-by-service', () => {
    it('returns the rules of every requested service in the per-service order, [] where none', async () => {
        const body = await json(await get(buildApp(), '/pay-rules-by-service?ids=s1,s2,s3'));
        expect(Object.keys(body.data).sort()).toEqual(['s1', 's2', 's3']);
        expect((body.data.s1 as Array<{ id: string }>).map((r) => r.id)).toEqual(['r1', 'r2']);
        expect(body.data.s2).toEqual([]);
        expect((body.data.s3 as Array<{ type: string; deductionCents: number }>)[0]).toMatchObject({ type: 'percent_after_deduction', deductionCents: 500 });
    });

    it('matches the per-service endpoint for every service', async () => {
        const app = buildApp();
        const bulk = (await json(await get(app, '/pay-rules-by-service?ids=s1,s2,s3'))).data;
        for (const id of ['s1', 's2', 's3']) {
            const one = (await json(await get(app, `/${id}/pay-rules`))).data;
            expect(bulk[id]).toEqual(one);
        }
    });

    it('never returns another tenant\'s service or its rules', async () => {
        const body = await json(await get(buildApp(), '/pay-rules-by-service?ids=s1,foreign'));
        expect(Object.keys(body.data)).toEqual(['s1']);
        expect(JSON.stringify(body)).not.toContain('9999');
    });

    it('statement count does not grow with the number of services', async () => {
        const app = buildApp();
        await get(app, '/pay-rules-by-service?ids=s1');
        const one = selects;
        selects = 0;
        await get(app, '/pay-rules-by-service?ids=s1,s2,s3,foreign');
        expect(selects).toBe(one);
    });

    it('keeps the per-service route\'s gates: an inspector is refused', async () => {
        expect((await get(buildApp('inspector'), '/pay-rules-by-service?ids=s1')).status).toBe(403);
    });
});
