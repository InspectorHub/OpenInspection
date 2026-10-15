/**
 * POST /api/invoices/request-payment stays available to an inspector (asking a
 * client for payment on site is a field act), but its answer repeats the
 * invoice amount, which a caller without `financial` does not get to read.
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
    it('an inspector without financial still sends the request, and the answer omits the amount', async () => {
        const res = await request('inspector', null);
        expect(res.status).toBe(200);
        const body = await res.json() as Record<string, unknown>;
        expect(body.id).toBe('inv1');
        expect(body.status).toBe('sent');
        expect('amountCents' in body).toBe(false);
    });
    it('an inspector granted financial receives the amount', async () => {
        const res = await request('inspector', { financial: true });
        expect((await res.json() as { amountCents?: number }).amountCents).toBe(45000);
    });
});
