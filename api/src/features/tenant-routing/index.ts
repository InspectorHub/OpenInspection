import type { MiddlewareHandler } from 'hono';
import type { HonoConfig } from '../../types/hono';
import { logger } from '../../lib/logger';
import { resolveByFixedTenant } from './resolve-by-fixed-tenant';
import { resolveByPathParam } from './resolve-by-path-param';

/**
 * Tenant resolution middleware.
 *
 * Reads `c.var.profile` (injected by DI middleware) to pick the
 * resolution strategy:
 *
 *   - profile.fixedTenantId       → resolveByFixedTenant   (standalone)
 *   - everything else (saas)      → defer to JWT mw downstream
 *
 * Path-param resolution runs first regardless of mode, so public
 * routes like `/book/:tenant/:slug` work uniformly across all
 * deploys. Subdomain-based resolution was retired with the
 * silo-deconvergence plan (2026-05-29) — silo + shared now share
 * the same path/JWT lookup; vanity subdomains, if any, are bound
 * by ops at the Cloudflare DNS + Worker-route layer and the tenant
 * row is identified by path or JWT inside the Worker either way.
 *
 * The 503 fallthrough fires ONLY in standalone mode when the fixed
 * tenant resolver failed AND the path isn't on the bypass list. In
 * saas mode the JWT middleware downstream owns tenantId — this
 * middleware just clears the way for it.
 */
export const tenantRouter: MiddlewareHandler<HonoConfig> = async (c, next) => {
    const url = new URL(c.req.url);
    const path = url.pathname;

    if (path === '/status') return next();

    // Try path-param resolution first. This makes /book/:tenant/:slug
    // and similar public routes work uniformly across all deploy
    // modes.
    const pathParamResolved = await resolveByPathParam(c, path);
    if (pathParamResolved) return next();

    const profile = c.var.profile;

    if (profile.fixedTenantId) {
        await resolveByFixedTenant(c, profile.fixedTenantId);

        // Standalone-mode safety net: if fixedTenantId resolution did
        // not populate tenant context, this is a system error —
        // surface a 503 for /api/* requests outside the bypass list.
        // Saas paths never reach here; they get a `return next()` below
        // and the JWT middleware downstream sets tenantId from the
        // verified token claim.
        if (!c.get('tenantId')) {
            const isBypassPath = path === '/setup' || path === '/login'
                || path === '/api/auth/setup' || path === '/api/auth/login'
                || path === '/status' || path.startsWith('/api/integration')
                || path === '/api/agent-signup' || path === '/api/agents/accept'
                || path === '/api/concierge/confirm'
                || path === '/api/concierge/book-info'
                || path === '/api/concierge/book'
                || path === '/api/concierge/confirm-info'
                || path.startsWith('/api/public/')
                // M2M admin endpoints carry tenantId in the request
                // body, not in the URL/JWT. They authenticate via
                // Bearer M2M secret instead of tenant routing. Bypass
                // tenant resolution to avoid 503 when the M2M caller
                // wants to act on a tenant other than the current
                // host's tenant.
                || path.startsWith('/api/admin/');
            if (!isBypassPath && path.startsWith('/api')) {
                logger.info('[TenantRouter] Tenant resolution failed', {
                    path,
                    tenantId: c.get('tenantId'),
                    subdomain: c.get('requestedSubdomain'),
                });
                return c.text('Tenant not found or system not initialized.', 503);
            }
        }
    }
    // saas: defer to JWT middleware downstream (it sets tenantId
    // from the verified token's claim).

    return next();
};
