import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import type { HonoConfig } from '../../../server/types/hono';
import { STANDALONE_PROFILE, SAAS_PROFILE } from '../../../server/lib/deployment-profile';

// Mock the fixed-tenant resolver so we can deterministically simulate the
// "resolver ran but tenantId remains unset" branch that the standalone 503
// safety net (introduced in Section A) defends against. Hoisted by vitest
// before tenantRouter loads, so the production middleware sees the stub.
vi.mock('../../../server/features/tenant-routing/resolve-by-fixed-tenant', () => ({
    resolveByFixedTenant: vi.fn(),
}));

import { tenantRouter } from '../../../server/features/tenant-routing';
import { resolveByFixedTenant } from '../../../server/features/tenant-routing/resolve-by-fixed-tenant';

const FALLBACK_TENANT = '00000000-0000-0000-0000-000000000000';

function makeApp(envOverrides: Partial<HonoConfig['Bindings']>, profile = STANDALONE_PROFILE) {
    const app = new Hono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('profile', profile);
        await next();
    });
    app.use('*', tenantRouter);
    return { app, env: envOverrides as HonoConfig['Bindings'] };
}

describe('tenant-routing — standalone path', () => {
    it('sets tenantId from profile.fixedTenantId when standalone', async () => {
        // Restore the resolver's real side effect for this happy-path test:
        // it sets tenantId from the arg it receives.
        vi.mocked(resolveByFixedTenant).mockImplementationOnce(async (c, tenantId) => {
            c.set('tenantId', tenantId);
        });
        const { app, env } = makeApp(
            { DB: {} as never, TENANT_CACHE: { get: vi.fn().mockResolvedValue(null), put: vi.fn() } as never },
            STANDALONE_PROFILE,
        );
        let capturedTenantId: string | undefined;
        app.get('/probe', (c) => { capturedTenantId = c.get('tenantId'); return c.text('ok'); });
        await app.request('/probe', { headers: { host: 'standalone.example' } }, env);
        expect(capturedTenantId).toBe(FALLBACK_TENANT);
    });

    it('falls through 503 on non-bypass /api/* paths when fixed-tenant resolution leaves tenantId unset', async () => {
        // Section F rewrite (Section A safety-net coverage). Simulate the
        // realistic broken-init state by mocking resolveByFixedTenant to
        // be a no-op — tenantId is never populated, the post-resolve check
        // in tenantRouter fires, and a 503 is returned for the non-bypass
        // /api/* path.
        vi.mocked(resolveByFixedTenant).mockImplementationOnce(async () => {
            // intentional no-op: simulates resolver finding no tenant row
        });
        const { app, env } = makeApp(
            { DB: {} as never, TENANT_CACHE: { get: vi.fn().mockResolvedValue(null), put: vi.fn() } as never },
            STANDALONE_PROFILE,
        );
        app.get('/api/me', (c) => c.json({ ok: true }));
        const res = await app.request('/api/me', {}, env);
        expect(res.status).toBe(503);
    });

    it('lets bypass /api/* paths through even when fixed-tenant resolution leaves tenantId unset', async () => {
        // Counterpart to the previous test: /api/auth/login is on the
        // bypass list, so the 503 branch must NOT fire even when the
        // resolver leaves tenantId unset. The request makes it past
        // tenantRouter to the (unregistered) handler. Hono returns 404.
        vi.mocked(resolveByFixedTenant).mockImplementationOnce(async () => {
            // no-op resolver — same broken-init scenario as the 503 test
        });
        const { app, env } = makeApp(
            { DB: {} as never, TENANT_CACHE: { get: vi.fn().mockResolvedValue(null), put: vi.fn() } as never },
            STANDALONE_PROFILE,
        );
        const res = await app.request('/api/auth/login', { method: 'POST' }, env);
        expect(res.status).toBe(404);
    });
});

describe('tenant-routing — saas mode', () => {
    // The /book/:tenant/:slug path-param happy path is covered by
    // tenant-routing-path-param.spec.ts (identical assertion) — not duplicated here.

    it('leaves tenantId unset on a non-public path so JWT middleware downstream can fill it', async () => {
        // Section F rewrite. Replaces the old "silo slug" describe.
        // In saas mode, tenantRouter's job for non-public paths is to do
        // nothing — JWT middleware downstream owns tenantId. We confirm
        // that contract: tenantId is undefined when the handler runs and
        // we got next()'d through.
        const { app, env } = makeApp(
            {
                DB: {} as never,
                TENANT_CACHE: { get: vi.fn().mockResolvedValue(null), put: vi.fn() } as never,
            },
            SAAS_PROFILE,
        );
        let capturedTenantId: string | undefined;
        let handlerRan = false;
        app.get('/api/me', (c) => {
            handlerRan = true;
            capturedTenantId = c.get('tenantId');
            return c.json({ ok: true });
        });
        const res = await app.request('/api/me', { headers: { host: 'app.example.com' } }, env);
        expect(handlerRan).toBe(true);
        expect(res.status).toBe(200);
        expect(capturedTenantId).toBeUndefined();
    });
});
