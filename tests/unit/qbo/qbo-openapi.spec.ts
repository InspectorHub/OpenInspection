/**
 * The ten QuickBooks admin routes are OpenAPI routes. qbo-route-authorization.spec.ts and qbo-route-financial.spec.ts
 * keep pinning the role and capability gates; this file pins what the conversion must not change (the exact bodies
 * and statuses, including the handler-side validation answers that a schema would have turned into a different
 * error), and what it adds (the operations, their capability and MCP tier, the dispatch of the path parameters).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { HonoConfig } from '../../../server/types/hono';
import { AppError } from '../../../server/lib/errors';
import { buildOpenApiDocument } from '../../../server/lib/openapi/build-document';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
vi.mock('../../../server/lib/jwt-keyring', () => ({
    verifyJwt: vi.fn(async () => ({ sub: 'u1' })),
}));

// eslint-disable-next-line import/order
import qboRoutes, { qboRouteConfigs } from '../../../server/api/qbo';

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const status = {
    realmId: 'r1', companyName: 'Acme', lastSyncAt: null, syncEnabled: true, openErrors: [], paymentDiscrepancies: [],
    heldDepositCount: 0, refreshTokenExpiresAt: 2, connectedAt: 1, environment: 'sandbox' as const, mappedCustomers: 0, mappedInvoices: 0,
};

const qbo = {
    getConnectionStatus: vi.fn(async () => status as typeof status | null),
    disconnect: vi.fn(async () => {}),
    setSyncEnabled: vi.fn(async () => false as boolean | null),
    runCDCSync: vi.fn(async () => ({ outcome: 'completed', processed: 3 }) as { outcome: string; processed?: number }),
    resolveError: vi.fn(async () => {}),
    getContactLink: vi.fn(async () => ({ linked: false, qboCustomerId: null, displayName: null, openErrorCount: 0 })),
    unlinkCustomer: vi.fn(async () => ({ removed: false })),
};

function buildApp(user: { sub: string } | null) {
    const app = new Hono<HonoConfig>();
    app.onError((err, c) => (err instanceof AppError
        ? c.json({ success: false, error: { code: err.code, message: err.message } }, err.status)
        : c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500)));
    app.use('*', async (c, next) => {
        c.set('tenantId', TENANT);
        c.set('userRole', 'owner');
        c.set('keyringPromise', Promise.resolve({} as never));
        if (user) c.set('user', user as never);
        c.set('services', { qbo, invoice: {} } as never);
        c.set('tenantSecretKeys', [] as never);
        return next();
    });
    app.route('/api/integrations/qbo', qboRoutes);
    return app;
}

interface CallOptions { method?: string; body?: unknown; user?: { sub: string } | undefined; env?: Record<string, unknown> }
const call = (path: string, opts: CallOptions = {}) => {
    const { method = 'GET', body, env = {} } = opts;
    return buildApp('user' in opts ? (opts.user ?? null) : { sub: 'u1' }).request(`/api/integrations/qbo${path}`, {
        method,
        headers: { Cookie: '__Host-inspector_token=stub', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    }, env);
};

describe('QuickBooks admin routes: bodies and statuses', () => {
    beforeEach(() => { Object.values(qbo).forEach((fn) => fn.mockClear()); });

    it('status answers {success, data:null} when there is no connection and the credential origins when there is', async () => {
        qbo.getConnectionStatus.mockResolvedValueOnce(null);
        expect(await (await call('/status')).json()).toEqual({ success: true, data: null });

        const res = await call('/status', { env: { QBO_CLIENT_ID: 'id-1', QBO_ENV: 'sandbox' } });
        const json = await res.json() as { data: { credentialSource: Record<string, string> } };
        expect(res.status).toBe(200);
        expect(json.data.credentialSource).toEqual({ clientId: 'env', clientSecret: 'missing', webhookToken: 'missing', environment: 'env' });
        expect(JSON.stringify(json)).not.toContain('id-1');
    });

    it('disconnect and dismiss answer {success:true}; dismiss reads the id from the path', async () => {
        expect(await (await call('/disconnect', { method: 'POST' })).json()).toEqual({ success: true });
        expect(await (await call('/errors/e9/dismiss', { method: 'POST' })).json()).toEqual({ success: true });
        expect(qbo.resolveError).toHaveBeenCalledWith(TENANT, 'e9');
    });

    it('pause answers the new setting, and 404 not_connected when there is no connection', async () => {
        qbo.setSyncEnabled.mockResolvedValueOnce(true);
        expect(await (await call('/pause', { method: 'POST' })).json()).toEqual({ success: true, data: { syncEnabled: true } });

        qbo.setSyncEnabled.mockResolvedValueOnce(null);
        const res = await call('/pause', { method: 'POST' });
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ success: false, error: { code: 'not_connected', message: 'Not connected' } });
    });

    it('sync answers the scan outcome, and 409 / 503 for the refusals the handler throws', async () => {
        const ok = await call('/sync', { method: 'POST' });
        const json = await ok.json() as { success: boolean; data: { processed: number; checkedAt: number } };
        expect(ok.status).toBe(200);
        expect(json.data.processed).toBe(3);
        expect(typeof json.data.checkedAt).toBe('number');

        qbo.runCDCSync.mockResolvedValueOnce({ outcome: 'not_connected' });
        expect((await call('/sync', { method: 'POST' })).status).toBe(409);
        qbo.runCDCSync.mockResolvedValueOnce({ outcome: 'paused' });
        expect((await call('/sync', { method: 'POST' })).status).toBe(409);
        qbo.runCDCSync.mockResolvedValueOnce({ outcome: 'incomplete', cause: new Error('x') } as never);
        expect((await call('/sync', { method: 'POST' })).status).toBe(503);
    });

    it('keeps the handler-side validation answer, not the schema envelope', async () => {
        const query = await call('/customers?q=a');
        expect(query.status).toBe(400);
        expect(await query.json()).toEqual({ success: false, error: { code: 'validation_error', message: 'Invalid query' } });

        const body = await call('/contacts/c1/link', { method: 'POST', body: {} });
        expect(body.status).toBe(400);
        expect(await body.json()).toEqual({ success: false, error: { code: 'validation_error', message: 'Invalid body' } });

        // Not even JSON: still the handler's answer.
        const garbage = await call('/contacts/c1/link', { method: 'POST', body: 'not json' });
        expect(garbage.status).toBe(400);
        expect(await garbage.json()).toEqual({ success: false, error: { code: 'validation_error', message: 'Invalid body' } });
    });

    it('refuses a link write or removal with no verified user behind it, and still reads without one', async () => {
        const noUser = undefined;
        const post = await call('/contacts/c1/link', { method: 'POST', body: { qboCustomerId: '58' }, user: noUser });
        const del = await call('/contacts/c1/link', { method: 'DELETE', user: noUser });
        expect(post.status).toBe(401);
        expect(del.status).toBe(401);
        expect(await del.json()).toEqual({ success: false, error: { code: 'unauthorized', message: 'Unauthorized' } });
        expect(qbo.unlinkCustomer).not.toHaveBeenCalled();
        // Positive control: the read has no actor requirement.
        expect((await call('/contacts/c1/link', { user: noUser })).status).toBe(200);
    });

    it('credential check keeps its two 400 bodies, with the missing setting names in details', async () => {
        const none = await call('/credentials/check', { method: 'POST' });
        expect(none.status).toBe(400);
        expect(await none.json()).toEqual({
            success: false,
            error: { code: 'credentials_missing', message: 'Client ID and Client Secret are both required', details: ['QBO_CLIENT_ID', 'QBO_CLIENT_SECRET'] },
        });

        const noBase = await call('/credentials/check', { method: 'POST', env: { QBO_CLIENT_ID: 'i', QBO_CLIENT_SECRET: 's' } });
        expect(noBase.status).toBe(400);
        expect(await noBase.json()).toEqual({ success: false, error: { code: 'app_base_url_missing', message: 'APP_BASE_URL is not set' } });
    });
});

describe('QuickBooks admin routes: operations in the OpenAPI document', () => {
    const doc = buildOpenApiDocument(qboRoutes, { openapi: '3.0.0', info: { version: 'test', title: 't' } }) as unknown as {
        paths?: Record<string, Record<string, Record<string, unknown>>>;
    };
    const op = (path: string, method: string) => doc.paths?.[path]?.[method];

    const expected: Array<[string, string, string, string, string[]]> = [
        ['/status', 'get', 'getQboConnectionStatus', 'extended', ['read']],
        ['/disconnect', 'post', 'disconnectQbo', 'excluded', []],
        ['/pause', 'post', 'toggleQboSync', 'excluded', []],
        ['/sync', 'post', 'syncQboNow', 'excluded', []],
        ['/errors/{id}/dismiss', 'post', 'dismissQboError', 'excluded', []],
        ['/customers', 'get', 'searchQboCustomers', 'excluded', []],
        ['/credentials/check', 'post', 'checkQboCredentials', 'excluded', []],
        ['/contacts/{contactId}/link', 'get', 'getQboContactLink', 'extended', ['read']],
        ['/contacts/{contactId}/link', 'post', 'linkQboContact', 'excluded', []],
        ['/contacts/{contactId}/link', 'delete', 'unlinkQboContact', 'excluded', []],
    ];

    it('lists all ten with the companyFinance capability the middleware enforces', () => {
        expect(qboRouteConfigs).toHaveLength(10);
        for (const [path, method, id, tier, scopes] of expected) {
            const operation = op(path, method);
            expect(operation?.operationId, `${method} ${path}`).toBe(id);
            expect(operation?.['x-capability'], `${method} ${path}`).toBe('companyFinance');
            expect(operation?.['x-tier'], `${method} ${path}`).toBe(tier);
            expect(operation?.['x-scopes'], `${method} ${path}`).toEqual(scopes);
        }
    });

    it('declares the capability on every route the router dispatches, so a route added later without it fails here', () => {
        // The guard is per route, not router-wide: a route registered without `middleware` would be reachable by a
        // manager whose companyFinance is off, and no other gate looks at it. Read the router's own dispatch table.
        const dispatched = qboRoutes.routes
            .filter((r) => r.method !== 'ALL')
            .map((r) => `${r.method.toLowerCase()} ${r.path}`);
        expect(dispatched.length).toBeGreaterThan(0);
        for (const key of new Set(dispatched)) {
            const [method, path] = key.split(' ') as [string, string];
            const operation = op(path.replace(/:([A-Za-z]+)/g, '{$1}'), method);
            expect(operation?.['x-capability'], `${key} must declare x-capability: companyFinance`).toBe('companyFinance');
        }
    });

    it('exposes to MCP only the two reads, and none of the routes that act on the Intuit account', () => {
        const exposed = expected.filter(([, , , tier]) => tier !== 'excluded').map(([path, method]) => `${method} ${path}`);
        expect(exposed).toEqual(['get /status', 'get /contacts/{contactId}/link']);
        // Positive control: the table is not vacuous.
        expect(expected.filter(([, , , tier]) => tier === 'excluded')).toHaveLength(8);
    });
});
