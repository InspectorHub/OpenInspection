import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { diMiddleware } from '../../server/lib/middleware/di';
import type { HonoConfig } from '../../server/types/hono';
import type { DeploymentProfile } from '../../server/lib/deployment-profile';

function makeApp(env: Partial<HonoConfig['Bindings']>) {
    const app = new Hono<HonoConfig>();
    app.use('*', diMiddleware);
    return { app, env: env as HonoConfig['Bindings'] };
}

const BASE_ENV: Partial<HonoConfig['Bindings']> = {
    DB: {} as never, TENANT_CACHE: {} as never, PHOTOS: {} as never,
    JWT_SECRET: 'x'.repeat(32), KEY_ENCRYPTION_SECRET: 'x'.repeat(32),
    TURNSTILE_SITE_KEY: '', TURNSTILE_SECRET_KEY: '',
    GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', GEMINI_API_KEY: '',
    RESEND_API_KEY: '', SENDER_EMAIL: '',
    APP_NAME: '', PRIMARY_COLOR: '', GA_MEASUREMENT_ID: '',
};

describe('di middleware — profile injection', () => {
    it('sets c.var.profile to a saas DeploymentProfile when APP_MODE=saas', async () => {
        // Section F rewrite. Previously asserted a topology field on the
        // profile — that field was deleted by the silo-deconvergence
        // refactor (the topology is now a per-tenant property, not a
        // deployment-wide one). The new saas profile has mode='saas', no
        // fixedTenantId, and wires PORTAL_API_URL into billingPortalUrl.
        const { app, env } = makeApp({
            ...BASE_ENV,
            APP_MODE: 'saas',
            PORTAL_API_URL: 'https://portal.example',
        });
        let captured: DeploymentProfile | undefined;
        app.get('/probe', (c) => {
            captured = c.var.profile;
            return c.text('ok');
        });
        const res = await app.request('/probe', {}, env);
        expect(res.status).toBe(200);
        expect(captured).toBeDefined();
        expect(captured!.mode).toBe('saas');
        expect(captured!.fixedTenantId).toBeNull();
        expect(captured!.hasBilling).toBe(true);
        expect(captured!.hasSeatQuota).toBe(true);
        expect(captured!.hasSetupWizard).toBe(false);
        expect(captured!.billingPortalUrl).toBe('https://portal.example');
    });

    it('defaults to standalone profile with empty env', async () => {
        const { app, env } = makeApp(BASE_ENV);
        let captured: DeploymentProfile | undefined;
        app.get('/probe', (c) => {
            captured = c.var.profile;
            return c.text('ok');
        });
        await app.request('/probe', {}, env);
        expect(captured!.mode).toBe('standalone');
        expect(captured!.fixedTenantId).toBe('00000000-0000-0000-0000-000000000000');
        expect(captured!.hasSetupWizard).toBe(true);
        expect(captured!.hasSeatQuota).toBe(false);
    });
});
