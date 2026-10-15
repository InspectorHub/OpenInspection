/**
 * Writes that set or change a money field need the `financial` capability.
 * What is refused is a CHANGE: the settings form forwards every field it holds,
 * so an unchanged resend of the price a caller was shown must pass.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { InspectionService } from '../../../server/services/inspection.service';
import { ScopedDB } from '../../../server/lib/db/scoped';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';
import type { UserRole } from '../../../server/types/auth';
import { createTestDb, setupSchema } from '../db';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
// eslint-disable-next-line import/order
import { inspectionsRoutes } from '../../../server/api/inspections';

const T = '00000000-0000-0000-0000-000000000001';
const ENV = { DB: {} } as HonoConfig['Bindings'];
let db: BetterSQLite3Database<typeof schema>;

function buildApp(role: UserRole, overrides: Record<string, boolean> | null = null) {
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) => (err instanceof AppError
        ? c.json({ success: false, error: { code: err.code, message: err.message } }, err.status)
        : c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500)));
    const sdb = new ScopedDB(db as never, T);
    app.use('*', async (c, next) => {
        c.set('tenantId', T);
        c.set('userRole', role);
        c.set('user', { sub: 'u1', role, tenantId: T });
        c.set('sdb', { getById: async () => ({ permissionOverrides: overrides }) } as unknown as HonoConfig['Variables']['sdb']);
        c.set('services', {
            inspection: new InspectionService({} as D1Database, undefined, sdb),
        } as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    app.route('/api/inspections', inspectionsRoutes);
    return app;
}

const patch = (app: OpenAPIHono<HonoConfig>, body: unknown) =>
    app.request('/api/inspections/i1', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }, ENV);

const row = async () => (await db.select().from(schema.inspections).where(eq(schema.inspections.id, 'i1')).get())!;

beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    const now = new Date();
    await db.insert(schema.tenants).values({
        id: T, slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: now,
    });
    await db.insert(schema.users).values({
        id: 'u1', tenantId: T, email: 'u1@acme.test', passwordHash: 'x', name: 'U1', role: 'inspector', createdAt: now,
    });
    await db.insert(schema.inspections).values({
        id: 'i1', tenantId: T, propertyAddress: '1 Oak St', date: '2099-01-01', status: 'confirmed',
        paymentStatus: 'unpaid', price: 45000, depositRequiredCents: 9000, depositOverridden: true,
        paymentRequired: false, agreementRequired: false, createdAt: now,
    });
});

describe('PATCH /api/inspections/:id money guard', () => {
    it('refuses a changed price without financial, names the code, and leaves the row alone', async () => {
        const res = await patch(buildApp('inspector'), { price: 1 });
        expect(res.status).toBe(403);
        expect(((await res.json()) as { error: { code: string } }).error.code).toBe('FINANCIAL_REQUIRED');
        expect((await row()).price).toBe(45000);
    });
    it('accepts an unchanged price resent with another edit', async () => {
        const res = await patch(buildApp('inspector'), { price: 45000, propertyAddress: '2 Elm St' });
        expect(res.status).toBe(200);
        expect((await row()).propertyAddress).toBe('2 Elm St');
        expect((await row()).price).toBe(45000);
    });
    it('accepts an edit that has no money field', async () => {
        const res = await patch(buildApp('inspector'), { propertyAddress: '3 Pine St' });
        expect(res.status).toBe(200);
    });
    it('refuses a changed deposit and does not touch the override flag', async () => {
        const res = await patch(buildApp('inspector'), { depositRequiredCents: 5000 });
        expect(res.status).toBe(403);
        const after = await row();
        expect(after.depositRequiredCents).toBe(9000);
        expect(after.depositOverridden).toBe(true);
    });
    it('refuses clearing the deposit', async () => {
        const res = await patch(buildApp('inspector'), { depositRequiredCents: null });
        expect(res.status).toBe(403);
        expect((await row()).depositRequiredCents).toBe(9000);
    });
    it('positive control: a manager may change the price', async () => {
        const res = await patch(buildApp('manager'), { price: 50000 });
        expect(res.status).toBe(200);
        expect((await row()).price).toBe(50000);
    });
    it('a manager with financial switched off is refused', async () => {
        const res = await patch(buildApp('manager', { financial: false }), { price: 50000 });
        expect(res.status).toBe(403);
    });
    it('an inspector granted financial may change the price', async () => {
        const res = await patch(buildApp('inspector', { financial: true }), { price: 50000 });
        expect(res.status).toBe(200);
    });
});

describe('POST /api/inspections money guard', () => {
    const create = (app: OpenAPIHono<HonoConfig>, extra: Record<string, unknown>) =>
        app.request('/api/inspections', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ propertyAddress: '9 Birch Rd', templateId: 't1', date: '2099-02-01T10:00:00Z', ...extra }),
        }, ENV);

    it('refuses a create that sets a price without financial', async () => {
        const res = await create(buildApp('inspector'), { price: 100 });
        expect(res.status).toBe(403);
        expect(((await res.json()) as { error: { code: string } }).error.code).toBe('FINANCIAL_REQUIRED');
    });
    it('refuses per-line price overrides without financial', async () => {
        const res = await create(buildApp('inspector'), { serviceSelections: [{ serviceId: 's1', priceOverrideCents: 1 }] });
        expect(res.status).toBe(403);
    });
    it('a create without any money field passes the guard (control for the refusals above)', async () => {
        const res = await create(buildApp('inspector'), {});
        expect(res.status).not.toBe(403);
        // Passed validation too: a 400 here would make the refusals above vacuous.
        expect(res.status).not.toBe(400);
    });
});
