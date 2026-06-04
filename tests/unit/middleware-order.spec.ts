/**
 * A-16 — middleware-order regression gate.
 *
 * The global middleware chain is two-phase around the JWT middleware:
 * context bootstrap (profile + keyring) and host/slug tenant resolution run
 * BEFORE it; everything tenant-scoped (integration secrets, the DI service
 * registry with its email/AI config, the palette slug) must run AFTER it,
 * because `c.get('tenantId')` for authed API requests is set by the JWT
 * middleware. This ordering silently regressed once — di + integration
 * secrets ran before JWT, so per-tenant email identity, Gemini BYOK and (in
 * saas) tenant integration secrets never loaded. Hono executes `app.use`
 * registrations in order, so pinning the registration order pins the
 * behavior.
 */
import { describe, it, expect } from 'vitest';
import { app, jwtAuthMiddleware } from '../../server/index';
import { contextBootstrap } from '../../server/lib/middleware/context-bootstrap';
import { diMiddleware } from '../../server/lib/middleware/di';
import { integrationSecretsMiddleware } from '../../server/lib/middleware/integration-secrets';
import { inspectorPaletteMiddleware } from '../../server/lib/middleware/inspector-palette';
import { touchLastActiveMiddleware } from '../../server/lib/middleware/touch-last-active';
import { tenantRouter } from '../../server/features/tenant-routing';

// Importing server/index pulls the whole app graph — generous timeout so the
// suite doesn't flap under CPU contention (same rationale as route-metadata).
describe('global middleware order', { timeout: 30_000 }, () => {
    const indexOf = (handler: unknown, name: string): number => {
        const i = app.routes.findIndex(r => r.handler === handler);
        expect(i, `${name} is not registered on the app`).toBeGreaterThanOrEqual(0);
        return i;
    };

    it('tenant-scoped middlewares run AFTER the JWT middleware', () => {
        const bootstrap = indexOf(contextBootstrap, 'contextBootstrap');
        const tenants   = indexOf(tenantRouter, 'tenantRouter');
        const jwt       = indexOf(jwtAuthMiddleware, 'jwtAuthMiddleware');
        const secrets   = indexOf(integrationSecretsMiddleware, 'integrationSecretsMiddleware');
        const di        = indexOf(diMiddleware, 'diMiddleware');
        const palette   = indexOf(inspectorPaletteMiddleware, 'inspectorPaletteMiddleware');
        const lastTouch = indexOf(touchLastActiveMiddleware, 'touchLastActiveMiddleware');

        // Bootstrap provides profile (tenantRouter/branding) + keyring (JWT).
        expect(bootstrap).toBeLessThan(tenants);
        expect(tenants).toBeLessThan(jwt);

        // Tenant-scoped consumers of the JWT's tenantId.
        expect(jwt).toBeLessThan(secrets);
        expect(jwt).toBeLessThan(di);
        expect(di).toBeLessThan(palette);

        // touchLastActive consumes c.var.services.user — di must come first.
        expect(di).toBeLessThan(lastTouch);
    });
});
