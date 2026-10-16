/**
 * Money WRITES and money-only reads sit behind a money capability, not only
 * behind a role. Company-wide money (invoices, price lists, pay rules, Stripe)
 * needs `companyFinance`; the service lines on one inspection need
 * `inspectionFees`. A manager whose bit for the surface is switched off must be
 * refused on every route of it, and holding the OTHER capability must not help;
 * a manager with the default capability set must get past the gate (the handler
 * may then answer 400/404/500 because this harness has no services behind it,
 * which is irrelevant to the gate).
 */
import { describe, it, expect, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';
import type { UserRole } from '../../../server/types/auth';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
// eslint-disable-next-line import/order
import invoiceRoutes from '../../../server/api/invoices';
// eslint-disable-next-line import/order
import { servicesRoutes } from '../../../server/api/services';
// eslint-disable-next-line import/order
import adminConfigRoutes from '../../../server/api/admin/admin-config';
// eslint-disable-next-line import/order
import inspectionServiceRoutes from '../../../server/api/inspections/services';

const T = '00000000-0000-0000-0000-000000000001';
const ENV = { DB: {} } as HonoConfig['Bindings'];

function buildApp(role: UserRole, overrides: Record<string, boolean> | null) {
    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) => (err instanceof AppError
        ? c.json({ success: false, error: { code: err.code, message: err.message } }, err.status)
        : c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500)));
    app.use('*', async (c, next) => {
        c.set('tenantId', T);
        c.set('userRole', role);
        c.set('user', { sub: 'actor', role, tenantId: T });
        c.set('sdb', { getById: async () => ({ permissionOverrides: overrides }) } as unknown as HonoConfig['Variables']['sdb']);
        c.set('services', {} as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    app.route('/api/invoices', invoiceRoutes);
    app.route('/api/services', servicesRoutes);
    app.route('/api/admin', adminConfigRoutes);
    app.route('/api/inspections', inspectionServiceRoutes);
    return app;
}

type Case = [method: string, path: string, body?: unknown];
const COMPANY_CASES: Case[] = [
    ['POST', '/api/invoices', { clientName: 'A', amountCents: 100 }],
    ['POST', '/api/invoices/inv1/mark-sent'],
    ['POST', '/api/invoices/inv1/mark-paid', { method: 'cash' }],
    ['DELETE', '/api/invoices/inv1'],
    ['POST', '/api/services', { name: 'Radon', price: 15000 }],
    ['PUT', '/api/services/svc1', { price: 16000 }],
    ['DELETE', '/api/services/svc1'],
    ['GET', '/api/services/svc1/pay-rules'],
    ['POST', '/api/services/svc1/pay-rules', { userId: null, type: 'percent', value: 5000 }],
    ['PUT', '/api/services/svc1/pay-rules/r1', { type: 'percent', value: 5000 }],
    ['DELETE', '/api/services/svc1/pay-rules/r1'],
    ['POST', '/api/services/discount-codes', { code: 'SAVE', type: 'percent', value: 10 }],
    ['PUT', '/api/services/discount-codes/d1', { active: false }],
    ['DELETE', '/api/services/discount-codes/d1'],
    ['GET', '/api/admin/stripe-connect'],
    ['PUT', '/api/admin/stripe-connect', { accountId: 'acct_123' }],
    ['DELETE', '/api/admin/stripe-connect'],
    ['GET', '/api/admin/earnings-summary'],
];
const FEES_CASES: Case[] = [
    ['POST', '/api/inspections/i1/services', { serviceId: 'svc1' }],
    ['PATCH', '/api/inspections/i1/services/l1', { priceOverrideCents: 100 }],
    ['DELETE', '/api/inspections/i1/services/l1'],
];

const call = (app: OpenAPIHono<HonoConfig>, [method, path, body]: Case) =>
    app.request(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, ENV);

describe.each(COMPANY_CASES)('company finances: %s %s', (method, path, body) => {
    const c: Case = [method, path, body];
    it('a manager with companyFinance switched off is refused with 403', async () => {
        const res = await call(buildApp('manager', { companyFinance: false }), c);
        expect(res.status).toBe(403);
    });
    it('inspectionFees alone does not open it', async () => {
        const res = await call(buildApp('manager', { inspectionFees: true, companyFinance: false }), c);
        expect(res.status).toBe(403);
    });
    it('positive control: a manager with the default capabilities gets past the gate', async () => {
        const res = await call(buildApp('manager', null), c);
        expect(res.status).not.toBe(403);
    });
});

describe.each(FEES_CASES)('inspection fees: %s %s', (method, path, body) => {
    const c: Case = [method, path, body];
    it('a manager with inspectionFees switched off is refused with 403', async () => {
        const res = await call(buildApp('manager', { inspectionFees: false }), c);
        expect(res.status).toBe(403);
    });
    it('companyFinance alone does not open it', async () => {
        const res = await call(buildApp('manager', { inspectionFees: false, companyFinance: true }), c);
        expect(res.status).toBe(403);
    });
    it('positive control: a manager with the default capabilities gets past the gate', async () => {
        const res = await call(buildApp('manager', null), c);
        expect(res.status).not.toBe(403);
    });
});
