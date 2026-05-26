import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { tenantRouter } from '../../src/features/tenant-routing';
import type { HonoConfig } from '../../src/types/hono';
import { STANDALONE_PROFILE, SAAS_SHARED_PROFILE, SAAS_SILO_PROFILE } from '../../src/lib/deployment-profile';

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
        const { app, env } = makeApp(
            { DB: { } as never, TENANT_CACHE: { get: vi.fn().mockResolvedValue(null), put: vi.fn() } as never },
            STANDALONE_PROFILE,
        );
        let capturedTenantId: string | undefined;
        app.get('/probe', (c) => { capturedTenantId = c.get('tenantId'); return c.text('ok'); });
        await app.request('/probe', { headers: { host: 'standalone.example' } }, env);
        expect(capturedTenantId).toBe('00000000-0000-0000-0000-000000000000');
    });
});

describe('tenant-routing — silo path', () => {
    it('resolves tenant from subdomain when saas-silo', async () => {
        const fakeTenant = { id: 'tenant-uuid', subdomain: 'acme', tier: 'pro', status: 'active' };
        const { app, env } = makeApp(
            {
                DB: { } as never,
                TENANT_CACHE: {
                    get: vi.fn().mockResolvedValue(fakeTenant),
                    put: vi.fn(),
                } as never,
            },
            SAAS_SILO_PROFILE,
        );
        let capturedTenantId: string | undefined;
        app.get('/probe', (c) => { capturedTenantId = c.get('tenantId'); return c.text('ok'); });
        await app.request('/probe', { headers: { host: 'acme.example.com' } }, env);
        expect(capturedTenantId).toBe('tenant-uuid');
    });
});

describe('tenant-routing — shared saas', () => {
    it('leaves tenant unresolved when host=app.<domain> (JWT will fill)', async () => {
        const { app, env } = makeApp(
            { DB: { } as never, TENANT_CACHE: { get: vi.fn(), put: vi.fn() } as never },
            SAAS_SHARED_PROFILE,
        );
        let capturedTenantId: string | undefined;
        app.get('/probe', (c) => { capturedTenantId = c.get('tenantId'); return c.text('ok'); });
        await app.request('/probe', { headers: { host: 'app.example.com' } }, env);
        expect(capturedTenantId).toBeUndefined();
    });
});
