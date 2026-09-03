import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';

vi.mock('../../../server/lib/jwt-keyring', () => ({
    verifyJwt: vi.fn(async () => ({ sub: 'u1' })),
}));

// eslint-disable-next-line import/order
import qboRoutes from '../../../server/api/qbo';
// eslint-disable-next-line import/order
import qboOauthRoutes from '../../../server/api/qbo-oauth';
// eslint-disable-next-line import/order
import { QBO_OAUTH_MOUNT, QBO_CALLBACK_PATH } from '../../../server/lib/qbo-oauth-paths';
import type { HonoConfig } from '../../../server/types/hono';

const ROOT = join(__dirname, '..', '..', '..');
const index = readFileSync(join(ROOT, 'server', 'index.ts'), 'utf8');
const page = readFileSync(join(ROOT, 'app', 'routes', 'settings-integrations-qbo.tsx'), 'utf8');

describe('the QBO in-process API is addressed as an API', () => {
    it('mounts qboRoutes under /api/integrations/qbo', () => {
        expect(index).toContain(`.route('/api/integrations/qbo', qboRoutes)`);
    });

    it('no longer mounts a Hono router under /settings/**', () => {
        expect(index).not.toMatch(/\.route\('\/settings\//);
    });

    it('has the settings page call the new base', () => {
        expect(page).toContain('/api/integrations/qbo');
        expect(page).not.toContain('${apiBase}/settings/integrations/qbo');
    });

    it('leaves the Intuit redirect URI untouched', () => {
        expect(QBO_OAUTH_MOUNT).toBe('/api/integrations/qbo');
        expect(QBO_CALLBACK_PATH).toBe('/api/integrations/qbo/callback');
    });
});

/**
 * Two routers now share one mount prefix, and `api/qbo.ts` carries TWO
 * router-wide `use('*')` guards (a cookie check that answers 401, then
 * `requireRole('owner','manager')`). `app.route(prefix, sub)` re-registers that
 * middleware at `prefix/*`, so it matches EVERY path under the prefix —
 * including `/connect` and `/callback`, which belong to `api/qbo-oauth.ts`.
 *
 * Intuit's redirect back to `/callback` carries no cookie, so if the management
 * router is registered FIRST its 401 answers the handshake and QuickBooks can
 * never be connected. Registering the OAuth pair first means its own handler
 * matches and returns before the prefix middleware is ever reached.
 *
 * That makes the registration order load-bearing, which is exactly the hazard
 * `api/qbo-oauth.ts`'s header describes for the webhook that used to share this
 * prefix. Nothing about the mount strings shows it, so it is pinned here.
 */
describe('the OAuth pair survives sharing the management API prefix', () => {
    it('registers qboOauthRoutes BEFORE qboRoutes', () => {
        const oauthAt = index.indexOf('.route(QBO_OAUTH_MOUNT, qboOauthRoutes)');
        const mgmtAt = index.indexOf(`.route('/api/integrations/qbo', qboRoutes)`);
        expect(oauthAt).toBeGreaterThan(-1);
        expect(mgmtAt).toBeGreaterThan(-1);
        expect(oauthAt).toBeLessThan(mgmtAt);
    });

    const build = (oauthFirst: boolean) => {
        const app = new Hono<HonoConfig>();
        if (oauthFirst) {
            app.route(QBO_OAUTH_MOUNT, qboOauthRoutes).route(QBO_OAUTH_MOUNT, qboRoutes);
        } else {
            app.route(QBO_OAUTH_MOUNT, qboRoutes).route(QBO_OAUTH_MOUNT, qboOauthRoutes);
        }
        return app;
    };

    // No cookie: this is the request Intuit makes.
    const callback = (app: Hono<HonoConfig>) =>
        app.request(QBO_CALLBACK_PATH, undefined, {} as never);

    it('answers the cookie-less Intuit callback when the pair is mounted first', async () => {
        const res = await callback(build(true));
        // No APP_BASE_URL in this env, so the handler's own first branch fires.
        // The point is that it is the HANDLER answering, not a 401 guard.
        expect(res.status).toBe(302);
        expect(res.headers.get('location')).toBe('/settings/integrations/qbo?error=not_configured');
    });

    it('would 401 the Intuit callback if the management router came first', async () => {
        const res = await callback(build(false));
        expect(res.status).toBe(401);
    });

    it('still guards the management routes under the shared prefix', async () => {
        const res = await build(true).request(`${QBO_OAUTH_MOUNT}/status`, undefined, {} as never);
        expect(res.status).toBe(401);
    });
});
