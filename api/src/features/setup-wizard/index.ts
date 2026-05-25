import { Hono } from 'hono';
import type { HonoConfig } from '../../types/hono';
import { SetupPage } from '../../templates/pages/setup';

/**
 * Setup-wizard feature module.
 *
 * Profile-gated mount: returns 404 when `profile.hasSetupWizard` is false
 * (saas modes never show the standalone first-run wizard — sysadmin /
 * portal-initiated provisioning handles tenant init there).
 *
 * The POST handler that finalises the wizard (creates the first admin user)
 * lives at `/api/auth/setup` inside `src/api/auth.ts`. That endpoint is also
 * unreachable in saas mode because the tenant-routing middleware refuses to
 * resolve `/setup`-prefixed paths without a real tenant — see
 * `features/tenant-routing/index.ts`.
 */
export function setupWizardRoutes(): Hono<HonoConfig> {
    const app = new Hono<HonoConfig>();

    // Profile gate — 404 unless the active deployment exposes a setup wizard.
    app.use('*', async (c, next) => {
        if (!c.var.profile?.hasSetupWizard) return c.notFound();
        return next();
    });

    // GET /setup → first-run wizard page.
    app.get('/', (c) => c.html(SetupPage({ branding: c.get('branding') })));

    return app;
}
