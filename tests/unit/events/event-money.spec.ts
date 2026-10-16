/**
 * Event types and visits carry prices (`defaultPriceCents`, `priceCents`).
 * Reads omit them without the matching money capability; writes that set one are
 * refused. Covers both mounts of the event-type catalogue: the admin settings
 * router (OpenAPI) and the plain events router.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { EventService } from '../../../server/services/event.service';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';
import type { UserRole } from '../../../server/types/auth';
import { createTestDb, setupSchema } from '../db';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
// eslint-disable-next-line import/order
import adminSettingsRoutes from '../../../server/api/admin/admin-settings';
// eslint-disable-next-line import/order
import eventsRoutes from '../../../server/api/events';

const T = '00000000-0000-0000-0000-000000000001';
const ENV = { DB: {} } as HonoConfig['Bindings'];
const MONEY_KEY = /"(price|[A-Za-z]*Cents)"\s*:/;
let db: BetterSQLite3Database<typeof schema>;

function buildApp(role: UserRole, overrides: Record<string, boolean> | null = null) {
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) => (err instanceof AppError
        ? c.json({ success: false, error: { code: err.code, message: err.message } }, err.status)
        : c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500)));
    app.use('*', async (c, next) => {
        c.set('tenantId', T);
        c.set('userRole', role);
        c.set('user', { sub: 'actor', role, tenantId: T });
        c.set('sdb', { getById: async () => ({ permissionOverrides: overrides }) } as unknown as HonoConfig['Variables']['sdb']);
        c.set('services', { event: new EventService({} as D1Database) } as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    app.route('/api/admin', adminSettingsRoutes);
    app.route('/api', eventsRoutes);
    return app;
}

const json = (method: string, body: unknown) => ({
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

beforeEach(async () => {
    const fix = createTestDb();
    db = fix.db;
    await setupSchema(fix.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    const now = new Date();
    await db.insert(schema.tenants).values({
        id: T, slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: now,
    });
    await db.insert(schema.eventTypes).values({
        id: 'et1', tenantId: T, name: 'Radon', slug: 'radon', defaultDurationMin: 60, defaultPriceCents: 15000, createdAt: now,
    } as never);
    await db.insert(schema.inspections).values({
        id: 'i1', tenantId: T, propertyAddress: '1 St', date: '2099-01-01', status: 'confirmed', paymentStatus: 'unpaid',
        price: 0, paymentRequired: false, agreementRequired: false, createdAt: now,
    });
    await db.insert(schema.inspectionEvents).values({
        id: 'ev1', tenantId: T, inspectionId: 'i1', eventTypeId: 'et1', scheduledAt: now, durationMin: 60,
        priceCents: 15000, createdAt: now,
    } as never);
});

// Reading an event type's default price and a visit's price are both inspectionFees, so the
// default inspector can price a visit. Writing the price list stays companyFinance.
const READS: Array<[url: string, bucket: 'companyFinance' | 'inspectionFees', other: 'companyFinance' | 'inspectionFees']> = [
    ['/api/admin/event-types', 'inspectionFees', 'companyFinance'],
    ['/api/event-types', 'inspectionFees', 'companyFinance'],
    ['/api/inspections/i1/events', 'inspectionFees', 'companyFinance'],
];

describe.each(READS)('GET %s', (url, bucket, other) => {
    it('positive control: a manager receives the price', async () => {
        const res = await buildApp('manager').request(url, {}, ENV);
        expect(res.status).toBe(200);
        expect(await res.text()).toMatch(MONEY_KEY);
    });
    it(`a manager with ${bucket} switched off receives no price key`, async () => {
        const res = await buildApp('manager', { [bucket]: false }).request(url, {}, ENV);
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).not.toMatch(MONEY_KEY);
        expect(text).toMatch(/"id"/);
    });
    it(`switching ${other} off does not hide it`, async () => {
        const res = await buildApp('manager', { [other]: false }).request(url, {}, ENV);
        expect(res.status).toBe(200);
        expect(await res.text()).toMatch(MONEY_KEY);
    });
});

describe('event writes', () => {
    it('admin: creating an event type with a price is refused without companyFinance', async () => {
        const res = await buildApp('manager', { companyFinance: false }).request(
            '/api/admin/event-types', json('POST', { name: 'Mold', slug: 'mold', defaultPriceCents: 9000 }), ENV);
        expect(res.status).toBe(403);
        expect(((await res.json()) as { error: { code: string } }).error.code).toBe('FINANCIAL_REQUIRED');
    });
    it('admin: creating an event type without a price passes the gate', async () => {
        const res = await buildApp('manager', { companyFinance: false }).request(
            '/api/admin/event-types', json('POST', { name: 'Mold', slug: 'mold' }), ENV);
        expect(res.status).toBe(200);
        expect(await res.text()).not.toMatch(MONEY_KEY);
    });
    it('admin: changing the price is refused, resending the stored price is not', async () => {
        const app = buildApp('manager', { companyFinance: false });
        expect((await app.request('/api/admin/event-types/et1', json('PATCH', { defaultPriceCents: 1 }), ENV)).status).toBe(403);
        const stored = await db.select().from(schema.eventTypes).where(eq(schema.eventTypes.id, 'et1')).get();
        expect(stored!.defaultPriceCents).toBe(15000);
        expect((await app.request('/api/admin/event-types/et1', json('PATCH', { name: 'Radon test', defaultPriceCents: 15000 }), ENV)).status).toBe(200);
    });
    it('admin: positive control, a manager may change the price', async () => {
        const res = await buildApp('manager').request('/api/admin/event-types/et1', json('PATCH', { defaultPriceCents: 1 }), ENV);
        expect(res.status).toBe(200);
    });
    it('plain router: a new event type with a price is refused without companyFinance, and allowed with it', async () => {
        const body = { name: 'Mold', slug: 'mold', defaultPriceCents: 9000 };
        expect((await buildApp('manager', { companyFinance: false }).request('/api/event-types', json('POST', body), ENV)).status).toBe(403);
        expect((await buildApp('manager').request('/api/event-types', json('POST', body), ENV)).status).toBe(201);
    });
    it('plain router: scheduling a visit with a price is refused without inspectionFees; without a price it is not', async () => {
        const base = { eventTypeId: 'et1', scheduledAt: '2099-01-02T10:00:00.000Z', durationMin: 60 };
        const noFin = buildApp('inspector', { inspectionFees: false });
        const refused = await noFin.request('/api/inspections/i1/events', json('POST', { ...base, priceCents: 500 }), ENV);
        expect(refused.status).toBe(403);
        const ok = await noFin.request('/api/inspections/i1/events', json('POST', base), ENV);
        expect(ok.status).toBe(201);
        expect(await ok.text()).not.toMatch(MONEY_KEY);
    });
    it('plain router: an inspector with the default inspectionFees may price a visit, and companyFinance alone may not', async () => {
        const base = { eventTypeId: 'et1', scheduledAt: '2099-01-02T10:00:00.000Z', durationMin: 60, priceCents: 500 };
        expect((await buildApp('inspector').request('/api/inspections/i1/events', json('POST', base), ENV)).status).toBe(201);
        const financeOnly = buildApp('inspector', { inspectionFees: false, companyFinance: true });
        expect((await financeOnly.request('/api/inspections/i1/events', json('POST', base), ENV)).status).toBe(403);
    });
});
