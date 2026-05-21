import type { MiddlewareHandler } from 'hono';
import type { HonoConfig } from '../../types/hono';
import { logger } from '../../lib/logger';
import { verifyM2mAuth } from '../../lib/m2m-auth';
import { resolveByFixedTenant } from './resolve-by-fixed-tenant';
import { resolveByPathParam } from './resolve-by-path-param';
import { resolveBySubdomain } from './resolve-by-subdomain';

/**
 * Tenant resolution middleware.
 *
 * Reads `c.var.profile` (injected by DI middleware) to pick the resolution
 * strategy:
 *
 *   - profile.fixedTenantId       → resolveByFixedTenant   (standalone)
 *   - profile.saasTopology=silo   → resolveBySubdomain      (silo)
 *   - profile.saasTopology=shared → leave unset; JWT mw fills it
 *
 * Replaces lib/middleware/tenant-router.ts. PR 1 keeps the exact same
 * external behavior; PR 2 adds a path-param `:tenant` resolution branch
 * once the new public URL shape (`/book/:tenant/:slug`) ships.
 */
export const tenantRouter: MiddlewareHandler<HonoConfig> = async (c, next) => {
    const url = new URL(c.req.url);
    const path = url.pathname;

    if (path === '/status') return next();

    // Try path-param resolution first. This makes /book/:tenant/:slug and
    // similar public routes work uniformly across all deploy modes.
    const pathParamResolved = await resolveByPathParam(c, path);
    if (pathParamResolved) return next();

    const profile = c.var.profile;
    const host = c.req.header('host') || '';
    let subdomain: string | null = null;

    const hostParts = host.split('.');
    if (hostParts.length > 2) {
        const potentialSubdomain = hostParts[0];
        if (potentialSubdomain !== 'www' && potentialSubdomain !== 'dev'
            && potentialSubdomain !== 'localhost' && potentialSubdomain !== 'app') {
            subdomain = potentialSubdomain;
        }
    }

    const headerSubdomain = c.req.header('x-tenant-subdomain');
    if (headerSubdomain
        && verifyM2mAuth(c.req.header('authorization'), c.env as unknown as Record<string, string | undefined>)) {
        subdomain = headerSubdomain;
    }

    if (profile.fixedTenantId) {
        await resolveByFixedTenant(c, profile.fixedTenantId);
    } else if (profile.saasTopology === 'silo' && subdomain) {
        await resolveBySubdomain(c, subdomain);
    } else if (profile.saasTopology === 'shared' && !subdomain) {
        return next();
    } else if (profile.saasTopology === 'shared' && subdomain) {
        await resolveBySubdomain(c, subdomain);
    }

    if (!c.get('tenantId') || !c.get('requestedSubdomain')) {
        const isBypassPath = path === '/setup' || path === '/login'
            || path === '/api/auth/setup' || path === '/api/auth/login'
            || path === '/status' || path.startsWith('/api/integration')
            || path === '/api/agent-signup' || path === '/api/agents/accept'
            || path === '/api/concierge/confirm'
            || path.startsWith('/api/public/')
            // M2M admin endpoints carry tenantId in the request body, not in the
            // URL/JWT. They authenticate via Bearer M2M secret instead of tenant
            // routing. Bypass tenant resolution to avoid 503 when the M2M caller
            // wants to act on a tenant other than the current host's tenant.
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

    return next();
};
