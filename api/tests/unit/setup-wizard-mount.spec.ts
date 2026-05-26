import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { setupWizardRoutes } from '../../src/features/setup-wizard';
import type { HonoConfig } from '../../src/types/hono';
import { STANDALONE_PROFILE, SAAS_SHARED_PROFILE } from '../../src/lib/deployment-profile';

describe('setup-wizard mount gating', () => {
    it('returns the setup page when profile.hasSetupWizard is true', async () => {
        const app = new Hono<HonoConfig>();
        app.use('*', async (c, next) => { c.set('profile', STANDALONE_PROFILE); await next(); });
        app.route('/setup', setupWizardRoutes());
        const res = await app.request('/setup', {}, {} as HonoConfig['Bindings']);
        expect([200, 302]).toContain(res.status);
    });

    it('returns 404 when profile.hasSetupWizard is false (saas)', async () => {
        const app = new Hono<HonoConfig>();
        app.use('*', async (c, next) => { c.set('profile', SAAS_SHARED_PROFILE); await next(); });
        app.route('/setup', setupWizardRoutes());
        const res = await app.request('/setup', {}, {} as HonoConfig['Bindings']);
        expect(res.status).toBe(404);
    });
});
