/**
 * The QuickBooks router administers the company's books, so it needs the
 * `companyFinance` capability on top of the owner/manager role. A manager whose
 * `companyFinance` bit is off loses every route, whatever they hold for
 * `inspectionFees`; the default manager keeps them.
 *
 * Same harness as qbo-route-authorization.spec.ts: the real router, a stubbed
 * verifier, services faked at the edge. The only new ingredient is an `sdb`
 * that answers the permission-overrides lookup.
 */
import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import type { HonoConfig } from '../../../server/types/hono';
import type { UserRole } from '../../../server/types/auth';
import { AppError } from '../../../server/lib/errors';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
vi.mock('../../../server/lib/jwt-keyring', () => ({
    verifyJwt: vi.fn(async () => ({ sub: 'u1' })),
}));

// eslint-disable-next-line import/order
import qboRoutes from '../../../server/api/qbo';
// eslint-disable-next-line import/order
import qboOauthRoutes from '../../../server/api/qbo-oauth';

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const qboService = {
    disconnect: vi.fn(async () => {}),
    setSyncEnabled: vi.fn(async () => false),
    getConnectionStatus: vi.fn(async () => ({ connected: true })),
    runSync: vi.fn(async () => ({})),
    resolveError: vi.fn(async () => {}),
    getContactLink: vi.fn(async () => ({ linked: false })),
    unlinkCustomer: vi.fn(async () => ({ removed: true })),
    searchCustomers: vi.fn(async () => ({ customers: [], nextStartPosition: null })),
};

function buildApp(role: UserRole, overrides: Record<string, boolean> | null) {
    const app = new Hono<HonoConfig>();
    app.onError((err, c) => (err instanceof AppError
        ? c.json({ success: false, error: { code: err.code, message: err.message } }, err.status)
        : c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500)));
    app.use('*', async (c, next) => {
        c.set('tenantId', TENANT_ID);
        c.set('userRole', role);
        c.set('keyringPromise', Promise.resolve({} as never));
        c.set('user', { sub: 'u1' } as never);
        c.set('sdb', { getById: async () => ({ permissionOverrides: overrides }) } as never);
        c.set('services', { qbo: qboService } as never);
        return next();
    });
    app.route('/api/integrations/qbo', qboOauthRoutes);
    app.route('/api/integrations/qbo', qboRoutes);
    return app;
}

type Case = [method: string, path: string, body?: unknown];
const CASES: Case[] = [
    ['GET', '/status'],
    ['POST', '/disconnect'],
    ['POST', '/pause'],
    ['POST', '/sync'],
    ['POST', '/errors/e1/dismiss'],
    ['GET', '/customers?q=smith'],
    ['POST', '/credentials/check', {}],
    ['GET', '/contacts/c1/link'],
    ['POST', '/contacts/c1/link', { qboCustomerId: '58' }],
    ['DELETE', '/contacts/c1/link'],
    ['GET', '/connect'],
];

const call = (app: Hono<HonoConfig>, [method, path, body]: Case) =>
    app.request(`/api/integrations/qbo${path}`, {
        method,
        headers: {
            Cookie: '__Host-inspector_token=stub',
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, { TENANT_CACHE: { put: async () => {} } });

describe.each(CASES)('%s %s', (method, path, body) => {
    const c: Case = [method, path, body];
    it('a manager with companyFinance switched off is refused', async () => {
        expect((await call(buildApp('manager', { companyFinance: false }), c)).status).toBe(403);
    });
    it('inspectionFees alone does not open it', async () => {
        expect((await call(buildApp('manager', { inspectionFees: true, companyFinance: false }), c)).status).toBe(403);
    });
    it('positive control: a default manager gets past the gate', async () => {
        expect((await call(buildApp('manager', null), c)).status).not.toBe(403);
    });
});
