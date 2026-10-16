/**
 * POST /api/invoices/request-payment stays available to an inspector (asking a
 * client for payment on site is a field act) while they hold `inspectionFees`,
 * which the answer's amount depends on. Without it the route now refuses the
 * caller outright (the amount redaction in the handler is a second line).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';
import type { UserRole } from '../../../server/types/auth';
import { createTestDb, setupSchema } from '../db';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
// eslint-disable-next-line import/order
import invoiceRoutes from '../../../server/api/invoices';

const T = '00000000-0000-0000-0000-000000000001';
const ENV = { DB: {} } as HonoConfig['Bindings'];
let db: BetterSQLite3Database<typeof schema>;

function buildApp(role: UserRole, overrides: Record<string, boolean> | null) {
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    const sent = { id: 'inv1', status: 'sent', sentAt: new Date(), amountCents: 45000, currency: 'USD' };
    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) => (err instanceof AppError
        ? c.json({ success: false, error: { code: err.code } }, err.status)
        : c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500)));
    app.use('*', async (c, next) => {
        c.set('tenantId', T);
        c.set('userRole', role);
        c.set('user', { sub: 'actor', role, tenantId: T });
        c.set('sdb', { getById: async () => ({ permissionOverrides: overrides }) } as unknown as HonoConfig['Variables']['sdb']);
        c.set('services', {
            people: { getPrimaryClient: async () => ({ name: 'Jane', email: 'jane@example.com' }) },
            invoice: { findByInspectionId: async () => sent, markSent: async () => {} },
            portalAccess: { issueToken: async () => 'tok' },
            email: { sendInvoiceRequest: async () => {} },
        } as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    app.route('/api/invoices', invoiceRoutes);
    return app;
}

const request = (role: UserRole, overrides: Record<string, boolean> | null) =>
    buildApp(role, overrides).request('/api/invoices/request-payment', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inspectionId: 'i1' }),
    }, ENV);

beforeEach(async () => {
    const fix = createTestDb();
    db = fix.db;
    await setupSchema(fix.sqlite);
    const now = new Date();
    await db.insert(schema.tenants).values({
        id: T, slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: now,
    });
    await db.insert(schema.inspections).values({
        id: 'i1', tenantId: T, propertyAddress: '1 St', date: '2099-01-01', status: 'confirmed',
        paymentStatus: 'unpaid', price: 45000, paymentRequired: false, agreementRequired: false, createdAt: now,
    });
});

describe('POST /api/invoices/request-payment', () => {
    it('positive control: a manager receives the amount', async () => {
        const res = await request('manager', null);
        expect(res.status).toBe(200);
        expect((await res.json() as { amountCents?: number }).amountCents).toBe(45000);
    });
    it('an inspector without inspectionFees is refused and nothing is sent', async () => {
        const res = await request('inspector', { inspectionFees: false });
        expect(res.status).toBe(403);
    });
    it('an inspector with the default inspectionFees receives the amount', async () => {
        const res = await request('inspector', null);
        expect((await res.json() as { amountCents?: number }).amountCents).toBe(45000);
    });
});
