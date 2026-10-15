import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import type { HonoConfig } from '../../../server/types/hono';
import type { UserRole } from '../../../server/types/auth';
import { AppError } from '../../../server/lib/errors';

/**
 * The QBO router is a COMPANY-integration admin surface, and every route on it
 * must require owner/manager.
 *
 * Why this spec exists: the router shipped with authentication only — it
 * verified the JWT and then ran the handler, with no role and no capability.
 * `POST /disconnect` revokes the Intuit refresh token and DELETEs the tenant's
 * entire `qbo_entity_map`, which is the OI-invoice -> QBO-invoice
 * correspondence table. Reconnecting does not restore it, so the next push
 * creates duplicate invoices in QuickBooks against the same DocNumbers. Any
 * signed-in inspector could do that.
 *
 * Neither authorization gate could see the problem. `check-capability-declarations.mjs`
 * scans for `createRoute(withMcpMetadata(` windows and this file is a hand-rolled
 * `new Hono()`, so it has zero windows and passes vacuously; the
 * authorization-surface spec is the same inversion against the live registry.
 * Both answer "do declaration and enforcement agree?" — a route that declares
 * nothing and mounts nothing looks correct to both. Hence an explicit HTTP-level
 * assertion here rather than a gate entry.
 *
 * Asserted at the HTTP boundary on the REAL router, deliberately: a unit call to
 * the middleware would not prove it is mounted, and a `createRoutesStub` test
 * does not run middleware at all.
 */

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

// The auth layer is not what is under test — authorization is. Stubbing the
// verifier keeps this spec on the role boundary instead of rebuilding a keyring.
vi.mock('../../../server/lib/jwt-keyring', () => ({
    verifyJwt: vi.fn(async () => ({ sub: 'u1' })),
}));

// eslint-disable-next-line import/order
import qboRoutes from '../../../server/api/qbo';

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const qboService = {
    disconnect: vi.fn(async () => {}),
    setSyncEnabled: vi.fn(async () => false),
    getConnectionStatus: vi.fn(async () => ({ connected: true })),
    runSync: vi.fn(async () => ({})),
    resolveError: vi.fn(async () => {}),
    linkExistingCustomer: vi.fn(async () => ({
        qboCustomerId: '58', displayName: 'Customer 58', replacedQboCustomerId: null, resolvedErrorCount: 2,
    })),
    unlinkCustomer: vi.fn(async () => ({ removed: true })),
    getContactLink: vi.fn(async () => ({
        linked: true, qboCustomerId: '58', displayName: 'Customer 58', openErrorCount: 3,
    })),
    searchCustomers: vi.fn(async () => ({ customers: [], nextStartPosition: null })),
};

// What the service returns is not what the route may send: these carry fields
// that exist on the QuickBooks object (and on a careless pass-through) but
// belong to no response.
const withExtras = <T extends object>(row: T) => ({ ...row, SyncToken: '7', Balance: 12.5, internalNote: 'x' });

function buildApp(role: UserRole | undefined) {
    const app = new Hono<HonoConfig>();

    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        }
        return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
    });

    // Mirrors what the global middleware chain has already established by the
    // time a request reaches this router.
    app.use('*', async (c, next) => {
        c.set('tenantId', TENANT_ID);
        if (role) c.set('userRole', role);
        c.set('keyringPromise', Promise.resolve({} as never));
        c.set('user', { sub: 'u1' } as never);
        c.set('services', { qbo: qboService } as never);
        return next();
    });

    app.route('/api/integrations/qbo', qboRoutes);
    return app;
}

function call(role: UserRole | undefined, path: string, method = 'POST', body?: unknown, env: Record<string, unknown> = {}) {
    return buildApp(role).request(`/api/integrations/qbo${path}`, {
        method,
        headers: {
            Cookie: '__Host-inspector_token=stub',
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, env);
}

describe('QBO router authorization', () => {
    beforeEach(() => {
        Object.values(qboService).forEach(fn => fn.mockClear());
    });

    it('refuses an inspector the destructive disconnect', async () => {
        const res = await call('inspector', '/disconnect');
        expect(res.status).toBe(403);
        // The refusal must happen BEFORE the service runs — a 403 returned
        // after the entity map was already deleted would be worthless.
        expect(qboService.disconnect).not.toHaveBeenCalled();
    });

    it('refuses an inspector pause and force-sync', async () => {
        expect((await call('inspector', '/pause')).status).toBe(403);
        expect((await call('inspector', '/sync')).status).toBe(403);
        expect(qboService.setSyncEnabled).not.toHaveBeenCalled();
        expect(qboService.runSync).not.toHaveBeenCalled();
    });

    it('refuses an inspector the connection status read', async () => {
        // Company books state — connected realm, company name, sync errors — is
        // not inspector-visible just because the page is reachable.
        expect((await call('inspector', '/status', 'GET')).status).toBe(403);
    });

    it('refuses a caller with no role at all', async () => {
        // An agent (client/realtor) JWT satisfies the router's auth check and
        // carries NO tenant and no staff role by design. It must not fall
        // through to a handler that would then act on `tenantId: undefined`.
        const res = await call(undefined, '/disconnect');
        expect(res.status).toBe(401);
        expect(qboService.disconnect).not.toHaveBeenCalled();
    });

    it('still admits owner and manager', async () => {
        // The control. Without this, every assertion above would also pass
        // against a router that refuses everyone.
        expect((await call('owner', '/disconnect')).status).toBe(200);
        expect((await call('manager', '/pause')).status).toBe(200);
        expect(qboService.disconnect).toHaveBeenCalledTimes(1);
    });
});

describe('QBO customer match routes', () => {
    beforeEach(() => {
        Object.values(qboService).forEach(fn => fn.mockClear());
    });

    const matchRoutes: Array<[string, string, unknown]> = [
        ['GET', '/customers?q=smith', undefined],
        ['GET', '/contacts/c1/link', undefined],
        ['POST', '/contacts/c1/link', { qboCustomerId: '58' }],
        ['DELETE', '/contacts/c1/link', undefined],
    ];
    const touched = () => [
        qboService.searchCustomers, qboService.getContactLink, qboService.linkExistingCustomer, qboService.unlinkCustomer,
    ];

    it('refuses an inspector, an agent and a caller with no role on every one of them', async () => {
        for (const [method, path, body] of matchRoutes) {
            expect((await call('inspector', path, method, body)).status, `inspector ${method} ${path}`).toBe(403);
            expect((await call('agent', path, method, body)).status, `agent ${method} ${path}`).toBe(403);
            expect((await call(undefined, path, method, body)).status, `no role ${method} ${path}`).toBe(401);
        }
        for (const fn of touched()) expect(fn).not.toHaveBeenCalled();
    });

    it('admits owner and manager on every one of them (positive control)', async () => {
        for (const role of ['owner', 'manager'] as const) {
            for (const [method, path, body] of matchRoutes) {
                expect((await call(role, path, method, body)).status, `${role} ${method} ${path}`).toBe(200);
            }
        }
    });

    it('rejects a POST body without qboCustomerId before touching the service', async () => {
        const res = await call('owner', '/contacts/c1/link', 'POST', {});

        expect(res.status).toBe(400);
        expect(qboService.linkExistingCustomer).not.toHaveBeenCalled();
    });

    it('reports how many open items the match closed, and who did it', async () => {
        const res = await call('owner', '/contacts/c1/link', 'POST', { qboCustomerId: '58' });

        const json = await res.json() as { data: { resolvedErrorCount: number; qboCustomerId: string; displayName: string } };
        expect(json.data).toMatchObject({ qboCustomerId: '58', displayName: 'Customer 58', resolvedErrorCount: 2 });
        // Tenant from the verified session, actor from the verified user: never the body.
        expect(qboService.linkExistingCustomer).toHaveBeenCalledWith(TENANT_ID, 'c1', '58', 'u1');
    });

    it('reports the open item count with the current match', async () => {
        const res = await call('manager', '/contacts/c1/link', 'GET');

        const json = await res.json() as { data: { linked: boolean; openErrorCount: number } };
        expect(json.data).toMatchObject({ linked: true, openErrorCount: 3 });
        expect(qboService.getContactLink).toHaveBeenCalledWith(TENANT_ID, 'c1');
    });

    it('unmatches with the actor recorded, and says whether anything was removed', async () => {
        const res = await call('owner', '/contacts/c1/link', 'DELETE');

        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ success: true, data: { removed: true } });
        expect(qboService.unlinkCustomer).toHaveBeenCalledWith(TENANT_ID, 'c1', 'u1');
    });

    it('sends only the documented fields of a search result and of a link read', async () => {
        qboService.searchCustomers.mockResolvedValueOnce({
            customers: [withExtras({
                id: '58', displayName: 'Customer 58', companyName: null, email: null, phone: null,
                active: true, linkedContactId: null, linkedContactName: null,
            })],
            nextStartPosition: null,
        } as never);
        qboService.getContactLink.mockResolvedValueOnce(withExtras({
            linked: true, qboCustomerId: '58', displayName: 'Customer 58', openErrorCount: 3,
        }) as never);

        const search = await (await call('owner', '/customers?q=smith', 'GET')).json() as { data: { customers: Array<Record<string, unknown>> } };
        const link = await (await call('owner', '/contacts/c1/link', 'GET')).json() as { data: Record<string, unknown> };

        expect(Object.keys(search.data.customers[0]!).sort()).toEqual([
            'active', 'companyName', 'displayName', 'email', 'id', 'linkedContactId', 'linkedContactName', 'phone',
        ]);
        expect(Object.keys(link.data).sort()).toEqual(['displayName', 'linked', 'openErrorCount', 'qboCustomerId']);
    });

    it('refuses control characters in search text and an absurd start position', async () => {
        const control = await call('owner', '/customers?q=sm%0Ath', 'GET');
        const far = await call('owner', '/customers?q=smith&startPosition=1000000000', 'GET');

        expect(control.status).toBe(400);
        expect(far.status).toBe(400);
        expect(qboService.searchCustomers).not.toHaveBeenCalled();
    });

    it('searches with the paging defaults, trimmed text and the session tenant', async () => {
        const res = await call('owner', '/customers?q=%20smith%20', 'GET');

        expect(res.status).toBe(200);
        expect(qboService.searchCustomers).toHaveBeenCalledWith(TENANT_ID, 'smith', 1, 20);
    });

    it('refuses search text that is blank, too short or too long without asking QuickBooks', async () => {
        for (const q of ['', '%20%20%20', 'a', 'x'.repeat(101)]) {
            expect((await call('owner', `/customers?q=${q}`, 'GET')).status, `q=${q.slice(0, 8)}`).toBe(400);
        }
        expect(qboService.searchCustomers).not.toHaveBeenCalled();
        // Positive control: the longest accepted text goes through.
        expect((await call('owner', `/customers?q=${'x'.repeat(100)}`, 'GET')).status).toBe(200);
    });

    it('refuses an out-of-range window', async () => {
        expect((await call('owner', '/customers?q=smith&limit=21', 'GET')).status).toBe(400);
        expect((await call('owner', '/customers?q=smith&startPosition=0', 'GET')).status).toBe(400);
        expect((await call('owner', '/customers?q=smith&limit=5&startPosition=3', 'GET')).status).toBe(200);
        expect(qboService.searchCustomers).toHaveBeenLastCalledWith(TENANT_ID, 'smith', 3, 5);
    });

    it('limits searches per company: a spent allowance answers 429 before QuickBooks is asked', async () => {
        const spent = { RATE_LIMITER: { limit: vi.fn(async () => ({ success: false })) } };
        const res = await call('owner', '/customers?q=smith', 'GET', undefined, spent);

        expect(res.status).toBe(429);
        expect(qboService.searchCustomers).not.toHaveBeenCalled();
        // Keyed by company, not by caller address.
        expect(spent.RATE_LIMITER.limit).toHaveBeenCalledWith({ key: `qbo-customer-search:${TENANT_ID}` });

        const open = { RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) } };
        expect((await call('owner', '/customers?q=smith', 'GET', undefined, open)).status).toBe(200);
    });
});

describe('QBO credential check route authorization', () => {
    const env = {
        QBO_CLIENT_ID: 'auth-spec-id', QBO_CLIENT_SECRET: 'auth-spec-secret',
        QBO_ENV: 'sandbox', APP_BASE_URL: 'https://oi.example.test',
    };
    const intuit = vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }));

    beforeEach(() => {
        intuit.mockClear();
        vi.stubGlobal('fetch', intuit);
    });
    afterEach(() => { vi.unstubAllGlobals(); });

    it('refuses an inspector, an agent and a caller with no role before anything reaches Intuit', async () => {
        expect((await call('inspector', '/credentials/check', 'POST', undefined, env)).status).toBe(403);
        expect((await call('agent', '/credentials/check', 'POST', undefined, env)).status).toBe(403);
        expect((await call(undefined, '/credentials/check', 'POST', undefined, env)).status).toBe(401);
        expect(intuit).not.toHaveBeenCalled();
    });

    it('admits owner and manager (positive control)', async () => {
        expect((await call('owner', '/credentials/check', 'POST', undefined, env)).status).toBe(200);
        expect((await call('manager', '/credentials/check', 'POST', undefined, env)).status).toBe(200);
        expect(intuit).toHaveBeenCalledTimes(2);
    });
});

describe('QBO router accepts the session token either way', () => {
    // The page that follows Intuit's cross-site redirect has no usable cookie
    // (the session cookie is SameSite=Strict), so it sends the token as a Bearer
    // credential. Authentication here has to honour both, as the global
    // middleware in front of it does.
    const callWith = (headers: Record<string, string>) => buildApp('owner').request(
        '/api/integrations/qbo/status', { method: 'GET', headers }, {},
    );

    it('admits a request that carries only a Bearer token', async () => {
        const res = await callWith({ Authorization: 'Bearer stub' });
        expect(res.status).toBe(200);
    });

    it('still admits a request that carries only the cookie (positive control)', async () => {
        const res = await callWith({ Cookie: '__Host-inspector_token=stub' });
        expect(res.status).toBe(200);
    });

    it('refuses a request that carries neither', async () => {
        const res = await callWith({});
        expect(res.status).toBe(401);
    });
});
