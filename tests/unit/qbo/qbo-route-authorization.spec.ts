import { describe, it, expect, vi, beforeEach } from 'vitest';
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
    linkExistingCustomer: vi.fn(async () => {}),
};

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
        c.set('services', { qbo: qboService } as never);
        return next();
    });

    app.route('/api/integrations/qbo', qboRoutes);
    return app;
}

function call(role: UserRole | undefined, path: string, method = 'POST') {
    return buildApp(role).request(`/api/integrations/qbo${path}`, {
        method,
        headers: { Cookie: '__Host-inspector_token=stub' },
    });
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
