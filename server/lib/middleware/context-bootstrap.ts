import { MiddlewareHandler } from 'hono';
import { HonoConfig } from '../../types/hono';
import { getDeploymentProfile } from '../deployment-profile';
import { buildKeyring } from '../jwt-keyring';

/**
 * A-16 — earliest-stage request context: deployment profile + JWT keyring.
 *
 * Extracted from diMiddleware so the service registry can move AFTER the JWT
 * middleware (which needs `keyringPromise`, while di's tenant-scoped preloads
 * need the JWT's `tenantId` — a circular ordering that one middleware cannot
 * satisfy). This must stay the first context middleware: `tenantRouter` and
 * `brandingMiddleware` read `c.var.profile`, and the JWT middleware awaits
 * `c.var.keyringPromise`.
 */
export const contextBootstrap: MiddlewareHandler<HonoConfig> = async (c, next) => {
    c.set('profile', getDeploymentProfile(c.env));
    // Per-request ES256 keyring. PEM → CryptoKey imports happen at most once
    // per request; downstream sign/verify call sites share the same Promise.
    // .catch() suppresses the "unhandled rejection" diagnostic for requests
    // that never touch JWTs (webhooks, healthchecks). Real awaiters still see
    // the original rejection — the .catch() returns a separate, swallowed
    // chain that never sees an `await`.
    const keyringPromise = buildKeyring(c.env as unknown as Record<string, string | undefined>);
    keyringPromise.catch(() => { /* defer reporting to the first awaiter */ });
    c.set('keyringPromise', keyringPromise);
    await next();
};
