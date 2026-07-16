import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { createTestDb, setupSchema } from '../db';
import {
    tenants,
    users,
    services,
    availability,
    tenantConfigs,
    templates,
} from '../../../server/lib/db/schema';
import type { HonoConfig } from '../../../server/types/hono';
import { AppError } from '../../../server/lib/errors';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';

/**
 * Task 4 (Track G) — company-level booking profile + aggregated tenant slots.
 *
 * The route handlers call `drizzle(c.env.DB)` directly, so we mock
 * drizzle-orm/d1 to return our better-sqlite3 test DB instance.
 * BookingService methods are also mocked via the services context variable
 * for the slots endpoint, while the profile endpoint queries DB directly.
 */

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// We must import bookingsRoutes AFTER the mock is set up.
// eslint-disable-next-line import/order
import { bookingsRoutes } from '../../../server/api/bookings';

// Rate-limit is a no-op in tests (no KV).
vi.mock('../../../server/lib/rate-limit', () => ({
    checkRateLimit: vi.fn().mockResolvedValue(undefined),
}));

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const TENANT_SLUG = 'acme-test';

// 2026-07-07 is a Tuesday (dayOfWeek = 2)
const TEST_DATE = '2026-07-07';

/** Fake env bindings passed as the third arg to app.request(). */
const FAKE_ENV = {
    DB: {},
    TURNSTILE_SITE_KEY: 'test-site-key',
} as HonoConfig['Bindings'];

function buildApp(
    db: BetterSQLite3Database<typeof schema>,
    bookingStubs: {
        hasAnyHours?: ReturnType<typeof vi.fn>;
        getQualifiedInspectorIds?: ReturnType<typeof vi.fn>;
        getTenantSlots?: ReturnType<typeof vi.fn>;
    } = {},
) {
    const app = new OpenAPIHono<HonoConfig>();

    // Convert AppError throws to the correct HTTP status (mirrors server/index.ts onError).
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
        // Inject minimal services with booking stubs.
        const fakeBooking = {
            hasAnyHours: bookingStubs.hasAnyHours ?? vi.fn().mockResolvedValue(true),
            getQualifiedInspectorIds: bookingStubs.getQualifiedInspectorIds ?? vi.fn().mockResolvedValue([]),
            getTenantSlots: bookingStubs.getTenantSlots ?? vi.fn().mockResolvedValue({ slots: [] }),
        };
        c.set('services', { booking: fakeBooking } as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    // Mount without a prefix — the routes live under their own paths.
    app.route('/', bookingsRoutes);
    // Wire the drizzle mock to return our test db instance on every call.
    (mockDrizzle as any).mockReturnValue(db);
    return app;
}

describe('GET /book/:tenant — company booking profile (IA-26)', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: any;

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db as BetterSQLite3Database<typeof schema>;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as any).mockReturnValue(db);

        // Seed a tenant.
        await db.insert(tenants).values({
            id: TENANT_ID, name: 'Acme Inspections', slug: TENANT_SLUG,
            tier: 'free', status: 'active', maxUsers: 5,
            deploymentMode: 'shared', createdAt: new Date(),
        } as any);
    });

    afterEach(() => sqlite.close());

    it('returns 404 for unknown tenant slug', async () => {
        const app = buildApp(db);
        const res = await app.request('/book/no-such-tenant', {}, FAKE_ENV);
        expect(res.status).toBe(404);
        const body = await res.json() as any;
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('not_found');
    });

    it('returns 200 with allowInspectorChoice=false and empty inspectors list', async () => {
        // Seed template rows needed for FK (services.template_id references templates.id).
        await db.insert(templates).values([
            { id: 'tpl-1', tenantId: TENANT_ID, name: 'Residential Template', version: 1, schema: '{}', createdAt: new Date(), updatedAt: new Date() },
        ] as any);
        // Seed one active+templated service and one active-no-template service.
        await db.insert(services).values([
            { id: 's1', tenantId: TENANT_ID, name: 'Residential', price: 40000, active: true, templateId: 'tpl-1', createdAt: new Date() },
            { id: 's2', tenantId: TENANT_ID, name: 'Radon', price: 15000, active: true, templateId: null, createdAt: new Date() },
            { id: 's3', tenantId: TENANT_ID, name: 'Inactive', price: 5000, active: false, templateId: null, createdAt: new Date() },
        ] as any);
        // Seed inspector + availability so the shared scan produces bookingOpen=true.
        await db.insert(users).values([
            { id: 'u-open', tenantId: TENANT_ID, email: 'open@x.com', passwordHash: 'h', role: 'inspector', name: 'Open', createdAt: new Date() },
        ] as any);
        await db.insert(availability).values([
            { id: 'av-open', tenantId: TENANT_ID, inspectorId: 'u-open', dayOfWeek: 1, startTime: '09:00', endTime: '17:00', createdAt: new Date() },
        ] as any);

        // The restructured handler always calls getQualifiedInspectorIds (not hasAnyHours).
        const getQualifiedInspectorIds = vi.fn().mockResolvedValue(['u-open']);
        const app = buildApp(db, { getQualifiedInspectorIds });

        const res = await app.request(`/book/${TENANT_SLUG}`, {}, FAKE_ENV);
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.success).toBe(true);
        expect(body.data.company).toBe('Acme Inspections');
        expect(body.data.bookingOpen).toBe(true);
        expect(body.data.allowInspectorChoice).toBe(false);
        expect(body.data.inspectors).toEqual([]);
        // Only s1 is active+templated.
        expect(body.data.services).toHaveLength(1);
        expect(body.data.services[0].id).toBe('s1');
        expect(body.data.turnstileSiteKey).toBe('test-site-key');
        expect(getQualifiedInspectorIds).toHaveBeenCalledWith(TENANT_ID, []);
    });

    it('returns bookingOpen=false when no qualified inspectors have hours', async () => {
        // Returning an empty qualified list short-circuits the availability scan
        // and produces bookingOpen=false without any DB round-trip for availability.
        const getQualifiedInspectorIds = vi.fn().mockResolvedValue([]);
        const app = buildApp(db, { getQualifiedInspectorIds });
        const res = await app.request(`/book/${TENANT_SLUG}`, {}, FAKE_ENV);
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.data.bookingOpen).toBe(false);
    });

    it('returns inspectors sorted by name when allowInspectorChoice=true', async () => {
        // Enable allowInspectorChoice in tenant_configs.
        await db.insert(tenantConfigs).values({
            tenantId: TENANT_ID,
            allowInspectorChoice: true,
            updatedAt: new Date(),
        } as any);

        // Seed inspectors: Charlie comes after Alice alphabetically.
        await db.insert(users).values([
            { id: 'u1', tenantId: TENANT_ID, email: 'charlie@x.com', passwordHash: 'h', role: 'inspector', name: 'Charlie', createdAt: new Date() },
            { id: 'u2', tenantId: TENANT_ID, email: 'alice@x.com', passwordHash: 'h', role: 'inspector', name: 'Alice', createdAt: new Date() },
            // u3 is qualified but has no availability rows — should NOT appear.
            { id: 'u3', tenantId: TENANT_ID, email: 'bob@x.com', passwordHash: 'h', role: 'inspector', name: 'Bob', createdAt: new Date() },
        ] as any);

        // Seed availability rows for u1 and u2 only.
        await db.insert(availability).values([
            { id: 'a1', tenantId: TENANT_ID, inspectorId: 'u1', dayOfWeek: 2, startTime: '08:00', endTime: '17:00', createdAt: new Date() },
            { id: 'a2', tenantId: TENANT_ID, inspectorId: 'u2', dayOfWeek: 2, startTime: '08:00', endTime: '17:00', createdAt: new Date() },
        ] as any);

        const getQualifiedInspectorIds = vi.fn().mockResolvedValue(['u1', 'u2', 'u3']);
        const app = buildApp(db, { getQualifiedInspectorIds });

        const res = await app.request(`/book/${TENANT_SLUG}`, {}, FAKE_ENV);
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.data.allowInspectorChoice).toBe(true);
        // u3 has no availability rows — excluded. u1=Charlie, u2=Alice → sorted: Alice, Charlie.
        expect(body.data.inspectors).toHaveLength(2);
        expect(body.data.inspectors[0].name).toBe('Alice');
        expect(body.data.inspectors[1].name).toBe('Charlie');
        // photoUrl field is present (even if null).
        expect('photoUrl' in body.data.inspectors[0]).toBe(true);
    });
});

describe('GET /book/:tenant/:slug — route-order lock (IA-26)', () => {
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

    it('inspector-scoped route returns data.inspectorId and does not shadow the 2-segment route', async () => {
        // Seed an inspector with a slug so /book/<tenant>/<slug> can resolve.
        await db.insert(users).values([
            { id: 'u-slug', tenantId: TENANT_ID, email: 'slug@x.com', passwordHash: 'h', role: 'inspector', name: 'Slug Inspector', slug: 'slug-inspector', createdAt: new Date() },
        ] as any);

        const app = buildApp(db);

        // 3-segment route: /book/<tenant>/<inspector-slug>
        const res3 = await app.request(`/book/${TENANT_SLUG}/slug-inspector`, {}, FAKE_ENV);
        expect(res3.status).toBe(200);
        const body3 = await res3.json() as any;
        expect(body3.success).toBe(true);
        // Inspector-scoped shape must carry inspectorId.
        expect(body3.data.inspectorId).toBe('u-slug');
        expect(body3.data.name).toBe('Slug Inspector');

        // 2-segment route still resolves independently (company profile shape has no inspectorId).
        const res2 = await app.request(`/book/${TENANT_SLUG}`, {}, FAKE_ENV);
        expect(res2.status).toBe(200);
        const body2 = await res2.json() as any;
        expect(body2.success).toBe(true);
        expect(body2.data).not.toHaveProperty('inspectorId');
        expect(body2.data.company).toBe('Acme Inspections');
    });
});

describe('GET /slots — aggregated tenant slots (IA-26)', () => {
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

    it('returns 404 for unknown tenant slug', async () => {
        const app = buildApp(db);
        const res = await app.request(`/slots?tenant=no-such-tenant&date=${TEST_DATE}`, {}, FAKE_ENV);
        // OpenAPI routes throw Errors.NotFound which the error middleware converts to 404.
        expect(res.status).toBe(404);
    });

    it('returns slot grid from getTenantSlots on the happy path', async () => {
        const slots = [
            { time: '08:00', available: true, inspectorIds: ['u1', 'u2'] },
            { time: '08:30', available: true, inspectorIds: ['u1'] },
            { time: '09:00', available: false, inspectorIds: [] },
        ];
        const getTenantSlots = vi.fn().mockResolvedValue({ slots });
        const app = buildApp(db, { getTenantSlots });

        const res = await app.request(`/slots?tenant=${TENANT_SLUG}&date=${TEST_DATE}`, {}, FAKE_ENV);
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.success).toBe(true);
        expect(body.data.slots).toHaveLength(3);
        expect(body.data.slots[0]).toEqual({ time: '08:00', available: true });
        expect(body.data.slots[2]).toEqual({ time: '09:00', available: false });
        expect(getTenantSlots).toHaveBeenCalledWith(TENANT_ID, TEST_DATE, []);
        // inspectorIds must NOT be in the response (private field).
        expect(body.data.slots[0]).not.toHaveProperty('inspectorIds');
    });

    it('passes serviceIds as a parsed array to getTenantSlots', async () => {
        const getTenantSlots = vi.fn().mockResolvedValue({ slots: [] });
        const app = buildApp(db, { getTenantSlots });
        const res = await app.request(`/slots?tenant=${TENANT_SLUG}&date=${TEST_DATE}&serviceIds=svc-1,svc-2`, {}, FAKE_ENV);
        expect(res.status).toBe(200);
        expect(getTenantSlots).toHaveBeenCalledWith(TENANT_ID, TEST_DATE, ['svc-1', 'svc-2']);
    });

    it('filters slots by inspectorId when provided (client-choice flow)', async () => {
        const INSPECTOR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002';
        const OTHER_INSPECTOR = 'cccccccc-cccc-4ccc-8ccc-000000000003';
        const slots = [
            { time: '08:00', available: true, inspectorIds: [INSPECTOR_ID, OTHER_INSPECTOR] },
            { time: '08:30', available: true, inspectorIds: [OTHER_INSPECTOR] }, // target inspector not free here
        ];
        const getTenantSlots = vi.fn().mockResolvedValue({ slots });
        const app = buildApp(db, { getTenantSlots });

        const res = await app.request(`/slots?tenant=${TENANT_SLUG}&date=${TEST_DATE}&inspectorId=${INSPECTOR_ID}`, {}, FAKE_ENV);
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        // 08:00: inspector IS in the list → available=true.
        expect(body.data.slots[0]).toEqual({ time: '08:00', available: true });
        // 08:30: inspector NOT in the list → available=false.
        expect(body.data.slots[1]).toEqual({ time: '08:30', available: false });
    });

    it('rejects missing date with 400', async () => {
        const app = buildApp(db);
        const res = await app.request(`/slots?tenant=${TENANT_SLUG}`, {}, FAKE_ENV);
        expect(res.status).toBe(400);
    });

    it('rejects malformed date with 400', async () => {
        const app = buildApp(db);
        const res = await app.request(`/slots?tenant=${TENANT_SLUG}&date=not-a-date`, {}, FAKE_ENV);
        expect(res.status).toBe(400);
    });
});
