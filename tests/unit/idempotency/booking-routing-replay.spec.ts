/**
 * The three mutating routes on the booking-routing settings surface.
 *
 * Two of them are settings writes and converge trivially; the interesting one
 * is `POST /api/admin/booking-routing/geocode-company`, which calls Google.
 * A retry there must not bill a second lookup NOR — the part a plain
 * "returns 200 twice" test would miss — leave the workspace anchored to
 * something different from what the first attempt returned.
 *
 * `PUT /booking-routing/service-origin` gets its own attention on the clear
 * path: setting an address writes three columns and clearing must null all
 * three, because a stale lat/lng left behind keeps routing to an office the
 * inspector no longer starts from, with the UI showing no override at all.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
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
let fetchCalls: string[];

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
    app.use('*', idempotencyMiddleware({ getDb: () => db as never }));
    app.route('/api/admin', adminRoutes);
    return app;
}

const ENV = { DB: {}, JWT_SECRET: 'test-secret', GOOGLE_PLACES_API_KEY: 'k' };
const EXEC = {
    waitUntil: (p: Promise<unknown>) => { void Promise.resolve(p).catch(() => {}); },
    passThroughOnException: () => {},
} as ExecutionContext;

function call(path: string, method: string, body?: unknown, key?: string, env: Record<string, unknown> = ENV) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (key) headers['Idempotency-Key'] = key;
    return buildApp().request(path, {
        method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, env, EXEC);
}

/** Google autocomplete + details, both answered from one stub. */
function stubGoogle(lat: number, lng: number, formatted: string) {
    fetchCalls = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        fetchCalls.push(String(url));
        if (String(url).includes('/autocomplete/')) {
            return new Response(JSON.stringify({ status: 'OK', predictions: [{ place_id: 'p1' }] }));
        }
        return new Response(JSON.stringify({
            status: 'OK',
            result: {
                place_id: 'p1',
                formatted_address: formatted,
                address_components: [{ long_name: 'Austin', short_name: 'Austin', types: ['locality'] }],
                geometry: { location: { lat, lng } },
            },
        }));
    }));
}

beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    vi.unstubAllGlobals();

    await db.insert(schema.tenants).values({
        id: TENANT, slug: 'a', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await db.insert(schema.tenantConfigs).values({
        tenantId: TENANT, companyAddress: '1 Main St, Austin, TX', updatedAt: new Date(),
    });
    await db.insert(schema.users).values({
        id: USER, tenantId: TENANT, email: 'u@test.com', passwordHash: 'h',
        role: 'inspector', name: 'Ann', createdAt: new Date(),
    });
});

const cfg = async () => (await db.select().from(schema.tenantConfigs)
    .where(eq(schema.tenantConfigs.tenantId, TENANT)).get())!;
const user = async () => (await db.select().from(schema.users)
    .where(eq(schema.users.id, USER)).get())!;

describe("PATCH '/api/admin/booking-routing' — settings converge on replay", () => {
    it('two patches under one key leave one strategy', async () => {
        const a = await call('/api/admin/booking-routing', 'PATCH', { routingStrategy: 'closest', minLeadHours: 24 }, 'br-1');
        const b = await call('/api/admin/booking-routing', 'PATCH', { routingStrategy: 'closest', minLeadHours: 24 }, 'br-1');
        expect(a.status).toBe(200);
        expect(b.status).toBe(200);
        const row = await cfg();
        expect(row.bookingRoutingStrategy).toBe('closest');
        expect(row.bookingMinLeadHours).toBe(24);
    });

    it('an omitted cutoff is left alone; an explicit null clears it', async () => {
        await call('/api/admin/booking-routing', 'PATCH', { sameDayCutoffTime: '15:00' });
        expect((await cfg()).bookingSameDayCutoffTime).toBe('15:00');
        // Changing only the strategy must not drop the cutoff — the zod
        // .partial()-shaped bug this codebase has already been bitten by.
        await call('/api/admin/booking-routing', 'PATCH', { routingStrategy: 'least_loaded' });
        expect((await cfg()).bookingSameDayCutoffTime).toBe('15:00');
        await call('/api/admin/booking-routing', 'PATCH', { sameDayCutoffTime: null });
        expect((await cfg()).bookingSameDayCutoffTime).toBeNull();
    });
});

describe("POST '/api/admin/booking-routing/geocode-company' — one anchor, one lookup", () => {
    it('replays without a second Google call and stores the same coordinates', async () => {
        stubGoogle(30.2672, -97.7431, '1 Main St, Austin, TX 78701, USA');
        const a = await call('/api/admin/booking-routing/geocode-company', 'POST', undefined, 'geo-1');
        const before = fetchCalls.length;
        const b = await call('/api/admin/booking-routing/geocode-company', 'POST', undefined, 'geo-1');

        expect(a.status).toBe(200);
        expect(b.status).toBe(200);
        expect(fetchCalls.length).toBe(before); // the replay never reached Google
        const row = await cfg();
        expect(row.companyLat).toBeCloseTo(30.2672, 4);
        expect(row.companyLng).toBeCloseTo(-97.7431, 4);
    });

    it('a missing API key is a NAMED body reason, not a 500 and not a silent null', async () => {
        const res = await call('/api/admin/booking-routing/geocode-company', 'POST', undefined, undefined, { DB: {}, JWT_SECRET: 's' });
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { resolved: boolean; reason: string } };
        expect(body.data.resolved).toBe(false);
        expect(body.data.reason).toBe('no_api_key');
        expect((await cfg()).companyLat).toBeNull();
    });

    it('an unresolvable address reports not_found and leaves the old anchor untouched', async () => {
        stubGoogle(30.2672, -97.7431, 'x');
        await call('/api/admin/booking-routing/geocode-company', 'POST');
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'ZERO_RESULTS', predictions: [] }))));
        const res = await call('/api/admin/booking-routing/geocode-company', 'POST');
        const body = await res.json() as { data: { reason: string } };
        expect(body.data.reason).toBe('not_found');
        expect((await cfg()).companyLat).toBeCloseTo(30.2672, 4);
    });
});

describe("PUT '/api/admin/booking-routing/service-origin' — set, replay, clear", () => {
    it('a repeated set leaves exactly one origin', async () => {
        stubGoogle(29.7604, -95.3698, '500 Main, Houston, TX');
        await call('/api/admin/booking-routing/service-origin', 'PUT', { userId: USER, address: '500 Main, Houston' }, 'so-1');
        await call('/api/admin/booking-routing/service-origin', 'PUT', { userId: USER, address: '500 Main, Houston' }, 'so-1');
        const row = await user();
        expect(row.serviceOriginAddress).toBe('500 Main, Houston');
        expect(row.serviceOriginLat).toBeCloseTo(29.7604, 4);
    });

    it('clearing nulls the coordinates too, so the inspector really does inherit again', async () => {
        stubGoogle(29.7604, -95.3698, '500 Main, Houston, TX');
        await call('/api/admin/booking-routing/service-origin', 'PUT', { userId: USER, address: '500 Main, Houston' });
        await call('/api/admin/booking-routing/service-origin', 'PUT', { userId: USER, address: null });
        const row = await user();
        expect(row.serviceOriginAddress).toBeNull();
        expect(row.serviceOriginLat).toBeNull();
        expect(row.serviceOriginLng).toBeNull();
    });

    it('an address that will not geocode is still STORED, and reports that it has no coordinates', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'ZERO_RESULTS', predictions: [] }))));
        const res = await call('/api/admin/booking-routing/service-origin', 'PUT', { userId: USER, address: 'nowhere at all' });
        const body = await res.json() as { data: { resolved: boolean; reason: string } };
        expect(body.data.resolved).toBe(false);
        expect(body.data.reason).toBe('not_found');
        const row = await user();
        expect(row.serviceOriginAddress).toBe('nowhere at all');
        expect(row.serviceOriginLat).toBeNull();
    });
});
