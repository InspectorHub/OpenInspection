import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { diMiddleware } from '../../src/lib/middleware/di';
import type { HonoConfig } from '../../src/types/hono';
import type { DeploymentProfile } from '../../src/lib/deployment-profile';

function makeApp(env: Partial<HonoConfig['Bindings']>) {
    const app = new Hono<HonoConfig>();
    app.use('*', diMiddleware);
    return { app, env: env as HonoConfig['Bindings'] };
}

describe('di middleware — profile injection', () => {
    it('sets c.var.profile to a DeploymentProfile derived from env', async () => {
        const { app, env } = makeApp({
            APP_MODE: 'saas', SAAS_TOPOLOGY: 'shared',
            PORTAL_API_URL: 'https://portal.example',
            DB: {} as never, TENANT_CACHE: {} as never, PHOTOS: {} as never,
            JWT_SECRET: 'x'.repeat(32), KEY_ENCRYPTION_SECRET: 'x'.repeat(32),
            TURNSTILE_SITE_KEY: '', TURNSTILE_SECRET_KEY: '',
            GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', GEMINI_API_KEY: '',
            RESEND_API_KEY: '', SENDER_EMAIL: '',
            APP_NAME: '', PRIMARY_COLOR: '', GA_MEASUREMENT_ID: '',
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
        expect(captured!.saasTopology).toBe('shared');
        expect(captured!.billingPortalUrl).toBe('https://portal.example');
    });

    it('defaults to standalone profile with empty env', async () => {
        const { app, env } = makeApp({
            DB: {} as never, TENANT_CACHE: {} as never, PHOTOS: {} as never,
            JWT_SECRET: 'x'.repeat(32), KEY_ENCRYPTION_SECRET: 'x'.repeat(32),
            TURNSTILE_SITE_KEY: '', TURNSTILE_SECRET_KEY: '',
            GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', GEMINI_API_KEY: '',
            RESEND_API_KEY: '', SENDER_EMAIL: '',
            APP_NAME: '', PRIMARY_COLOR: '', GA_MEASUREMENT_ID: '',
        });
        let captured: DeploymentProfile | undefined;
        app.get('/probe', (c) => {
            captured = c.var.profile;
            return c.text('ok');
        });
        await app.request('/probe', {}, env);
        expect(captured!.mode).toBe('standalone');
    });
});
