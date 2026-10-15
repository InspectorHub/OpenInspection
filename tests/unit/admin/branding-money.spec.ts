/**
 * The company settings carry two money policies: the cancellation ladder and
 * the default booking deposit. Without the `financial` capability they are
 * absent from the read, and a write that sets or changes one is refused. A
 * write that leaves them alone (or resends them unchanged) is not.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { BrandingService } from '../../../server/services/branding.service';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';
import type { UserRole } from '../../../server/types/auth';
import { createTestDb, setupSchema } from '../db';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
// eslint-disable-next-line import/order
import adminBrandingRoutes from '../../../server/api/admin/branding';

const T = '00000000-0000-0000-0000-000000000001';
const ENV = { DB: {} } as HonoConfig['Bindings'];
const POLICY = {
    noticeHours: 24,
    // Zero-fee rungs: a ladder that charges needs the agreement-clause attestation,
    // which is a separate rule from the one under test.
    lateFee: { type: 'percent', percent: 0 },
    noShowFee: { type: 'percent', percent: 0 },
    remedy: 'refund',
};
const DEPOSIT = { type: 'fixed', amountCents: 9000 };
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
        c.set('services', { branding: new BrandingService({} as D1Database) } as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    app.route('/api/admin', adminBrandingRoutes);
    return app;
}

const read = (role: UserRole, overrides: Record<string, boolean> | null) =>
    buildApp(role, overrides).request('/api/admin/branding', {}, ENV);
const write = (role: UserRole, overrides: Record<string, boolean> | null, body: unknown) =>
    buildApp(role, overrides).request('/api/admin/branding', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }, ENV);
const stored = async () => (await db.select().from(schema.tenantConfigs).where(eq(schema.tenantConfigs.tenantId, T)).get())!;

beforeEach(async () => {
    const fix = createTestDb();
    db = fix.db;
    await setupSchema(fix.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    await db.insert(schema.tenants).values({
        id: T, slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await db.insert(schema.tenantConfigs).values({
        tenantId: T, updatedAt: new Date(), companyName: 'Acme', cancellationPolicy: POLICY, depositPolicy: DEPOSIT,
    } as never);
});

describe('GET /api/admin/branding', () => {
    it('positive control: a manager receives both policies', async () => {
        const body = await (await read('manager', null)).json() as { data: { branding: Record<string, unknown> } };
        expect(body.data.branding.cancellationPolicy).toEqual(POLICY);
        expect(body.data.branding.depositPolicy).toEqual(DEPOSIT);
    });
    it('a manager with financial switched off receives neither, and still receives the rest', async () => {
        const res = await read('manager', { financial: false });
        const text = await res.text();
        const branding = (JSON.parse(text) as { data: { branding: Record<string, unknown> } }).data.branding;
        expect('cancellationPolicy' in branding).toBe(false);
        expect('depositPolicy' in branding).toBe(false);
        expect(branding.companyName).toBe('Acme');
        expect(text).not.toMatch(/amountCents/);
    });
});

describe('POST /api/admin/branding', () => {
    it('refuses a changed cancellation policy without financial and leaves it stored', async () => {
        const res = await write('manager', { financial: false }, { cancellationPolicy: { ...POLICY, noticeHours: 48 } });
        expect(res.status).toBe(403);
        expect(((await res.json()) as { error: { code: string } }).error.code).toBe('FINANCIAL_REQUIRED');
        expect((await stored()).cancellationPolicy).toEqual(POLICY);
    });
    it('refuses a changed deposit policy without financial', async () => {
        const res = await write('manager', { financial: false }, { depositPolicy: { type: 'fixed', amountCents: 1 } });
        expect(res.status).toBe(403);
        expect((await stored()).depositPolicy).toEqual(DEPOSIT);
    });
    it('refuses clearing a stored policy without financial', async () => {
        expect((await write('manager', { financial: false }, { depositPolicy: null })).status).toBe(403);
    });
    it('accepts a settings save that resends the stored policies unchanged', async () => {
        const res = await write('manager', { financial: false }, { companyName: 'Acme 2', cancellationPolicy: POLICY, depositPolicy: DEPOSIT });
        expect(res.status).toBe(200);
        expect((await stored()).companyName).toBe('Acme 2');
    });
    it('accepts a save that does not mention the policies', async () => {
        expect((await write('manager', { financial: false }, { companyName: 'Acme 3' })).status).toBe(200);
    });
    it('positive control: a manager may change the deposit policy', async () => {
        const res = await write('manager', null, { depositPolicy: { type: 'fixed', amountCents: 1 } });
        expect(res.status).toBe(200);
        expect((await stored()).depositPolicy).toEqual({ type: 'fixed', amountCents: 1 });
    });
});
