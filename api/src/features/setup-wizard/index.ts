import { Hono } from 'hono';
import type { HonoConfig } from '../../types/hono';

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
 *
 * NOTE: The setup page HTML is now served by the Remix frontend.
 * This module only provides the profile gate so that /setup returns 404
 * in saas modes where the wizard is not applicable.
 */
export function setupWizardRoutes(): Hono<HonoConfig> {
    const app = new Hono<HonoConfig>();

    // Profile gate — 404 unless the active deployment exposes a setup wizard.
    app.use('*', async (c, next) => {
        if (!c.var.profile?.hasSetupWizard) return c.notFound();
        return next();
    });

    // GET /setup — Remix frontend serves the actual page; this handler
    // returns a minimal redirect or passthrough so Remix can pick it up.
    // The profile gate above ensures saas deploys get 404.
    app.get('/', (c) => c.text('Setup wizard', 200));

    return app;
}
