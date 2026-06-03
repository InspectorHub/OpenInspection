import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { tenantRouter } from '../../server/features/tenant-routing';
import type { HonoConfig } from '../../server/types/hono';
import { SAAS_PROFILE, STANDALONE_PROFILE } from '../../server/lib/deployment-profile';

function makeApp(profile = SAAS_PROFILE) {
    const app = new Hono<HonoConfig>();
    app.use('*', async (c, next) => { c.set('profile', profile); await next(); });
    app.use('*', tenantRouter);
    return app;
}

describe('tenant-routing — path-param resolution', () => {
    it('extracts tenant from /book/:tenant/:slug path', async () => {
        const fakeTenant = { id: 'tenant-uuid', slug: 'acme', tier: 'pro', status: 'active' };
        const env: Partial<HonoConfig['Bindings']> = {
            DB: { } as never,
            TENANT_CACHE: { get: vi.fn().mockResolvedValue(fakeTenant), put: vi.fn() } as never,
        };
        const app = makeApp();
        let capturedTenantId: string | undefined;
        app.get('/book/:tenant/:slug', (c) => { capturedTenantId = c.get('tenantId'); return c.text('ok'); });
        await app.request('/book/acme/jane-doe', { headers: { host: 'app.example.com' } }, env as HonoConfig['Bindings']);
        expect(capturedTenantId).toBe('tenant-uuid');
    });

    it('path-param wins over slug', async () => {
        const aTenant = { id: 'tenant-a', slug: 'acme', tier: 'pro', status: 'active' };
        const bTenant = { id: 'tenant-b', slug: 'bravo', tier: 'pro', status: 'active' };
        const get = vi.fn((key: string) => Promise.resolve(key.endsWith('acme') ? aTenant : bTenant));
        const env: Partial<HonoConfig['Bindings']> = { DB: {} as never, TENANT_CACHE: { get, put: vi.fn() } as never };
        const app = makeApp();
        let capturedTenantId: string | undefined;
        app.get('/book/:tenant/:slug', (c) => { capturedTenantId = c.get('tenantId'); return c.text('ok'); });
        await app.request('/book/acme/jane', { headers: { host: 'bravo.example.com' } }, env as HonoConfig['Bindings']);
        expect(capturedTenantId).toBe('tenant-a');
    });

    it('falls through to fixed tenant in standalone even when /book/<tenant>/<slug> is hit', async () => {
        const env: Partial<HonoConfig['Bindings']> = { DB: {} as never, TENANT_CACHE: { get: vi.fn().mockResolvedValue(null), put: vi.fn() } as never };
        const app = makeApp(STANDALONE_PROFILE);
        let capturedTenantId: string | undefined;
        app.get('/book/:tenant/:slug', (c) => { capturedTenantId = c.get('tenantId'); return c.text('ok'); });
        await app.request('/book/missing-tenant/jane', { headers: { host: 'localhost' } }, env as HonoConfig['Bindings']);
        expect(capturedTenantId).toBe('00000000-0000-0000-0000-000000000000');
    });
});
