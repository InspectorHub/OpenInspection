/**
 * The inspections CSV export and the financial capability: without it the
 * price column is absent (header and cells), not blanked, and the rows are the
 * same rows.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { DataService } from '../../../server/services/data.service';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';
import type { UserRole } from '../../../server/types/auth';
import { createTestDb, setupSchema } from '../db';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
// eslint-disable-next-line import/order
import dataRoutes from '../../../server/api/data';
// eslint-disable-next-line import/order
import adminDataRoutes from '../../../server/api/admin/admin-data';

const T = '00000000-0000-0000-0000-0000000000e1';
let db: BetterSQLite3Database<typeof schema>;

beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    await db.insert(schema.tenants).values({
        id: T, slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await db.insert(schema.inspections).values([
        { id: 'i1', tenantId: T, propertyAddress: '1 Main St', date: '2026-06-01', status: 'confirmed',
          paymentStatus: 'unpaid', price: 45000, paymentRequired: false, agreementRequired: false, createdAt: new Date() },
        { id: 'i2', tenantId: T, propertyAddress: '2 Oak Ave', date: '2026-06-02', status: 'confirmed',
          paymentStatus: 'unpaid', price: 31000, paymentRequired: false, agreementRequired: false, createdAt: new Date() },
    ]);
});

describe('DataService.exportInspectionsCSV includeMoney', () => {
    it('includes price_cents by default and by request (positive control)', async () => {
        const svc = new DataService({} as D1Database);
        for (const csv of [await svc.exportInspectionsCSV(T), await svc.exportInspectionsCSV(T, true)]) {
            expect(csv.split('\n')[0]).toContain('price_cents');
            expect(csv).toContain('45000');
        }
    });
    it('omits the price column and every price cell when includeMoney is false, keeping all rows', async () => {
        const svc = new DataService({} as D1Database);
        const withMoney = (await svc.exportInspectionsCSV(T, true)).split('\n');
        const without = (await svc.exportInspectionsCSV(T, false)).split('\n');
        expect(without[0]).not.toContain('price_cents');
        expect(without.join('\n')).not.toMatch(/45000|31000/);
        expect(without.length).toBe(withMoney.length);
        expect(without[0].split(',').length).toBe(withMoney[0].split(',').length - 1);
    });
});

function buildApp(role: UserRole, overrides: Record<string, boolean> | null) {
    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) => (err instanceof AppError
        ? c.json({ success: false, error: { code: err.code } }, err.status)
        : c.json({ success: false }, 500)));
    app.use('*', async (c, next) => {
        c.set('tenantId', T);
        c.set('userRole', role);
        c.set('user', { sub: 'actor', role, tenantId: T });
        c.set('sdb', { getById: async () => ({ permissionOverrides: overrides }) } as unknown as HonoConfig['Variables']['sdb']);
        await next();
    });
    app.route('/api/data', dataRoutes);
    return app;
}
const exportAs = (role: UserRole, overrides: Record<string, boolean> | null) =>
    buildApp(role, overrides).request('/api/data/export/inspections', {}, { DB: {} } as HonoConfig['Bindings']);

describe('GET /api/data/export/inspections', () => {
    it('manager with financial: price column present', async () => {
        const csv = await (await exportAs('manager', null)).text();
        expect(csv.split('\n')[0]).toContain('price_cents');
        expect(csv).toContain('45000');
    });
    it('manager with financial switched off: no price column, same rows', async () => {
        const csv = await (await exportAs('manager', { financial: false })).text();
        expect(csv.split('\n')[0]).not.toContain('price_cents');
        expect(csv).not.toContain('45000');
        expect(csv.split('\n').length).toBe(3);
    });
});

describe('GET /api/admin/export (full JSON export)', () => {
    const exportJson = async (role: UserRole, overrides: Record<string, boolean> | null) => {
        const app = new OpenAPIHono<HonoConfig>();
        app.onError((err, c) => (err instanceof AppError ? c.json({ success: false }, err.status) : c.json({ success: false }, 500)));
        app.use('*', async (c, next) => {
            c.set('tenantId', T);
            c.set('userRole', role);
            c.set('user', { sub: 'actor', role, tenantId: T });
            c.set('sdb', { getById: async () => ({ permissionOverrides: overrides }) } as unknown as HonoConfig['Variables']['sdb']);
            c.set('services', {
                admin: { getExport: async () => ({
                    inspections: [{ id: 'i1', price: 45000, depositRequiredCents: 9000 }],
                    templates: [{ id: 't1', schema: { fields: [{ price: 'label kept' }] } }],
                }) },
            } as unknown as HonoConfig['Variables']['services']);
            await next();
        });
        app.route('/api/admin', adminDataRoutes);
        const res = await app.request('/api/admin/export', {}, { DB: {} } as HonoConfig['Bindings']);
        expect(res.status).toBe(200);
        return res.text();
    };
    it('manager: inspection money present (positive control)', async () => {
        expect(await exportJson('manager', null)).toContain('"price":45000');
    });
    it('manager without financial: inspection money absent, template JSON untouched', async () => {
        const body = await exportJson('manager', { financial: false });
        expect(body).not.toMatch(/"price":45000|depositRequiredCents/);
        expect(body).toContain('label kept');
    });
});
