import { MiddlewareHandler } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenants } from '../db/schema';
import { HonoConfig } from '../../types/hono';
import { logger } from '../logger';

/**
 * Middleware to resolve the current tenant/workspace.
 * In standalone mode, uses the global workspace.
 * In SaaS mode, resolves based on subdomain.
 */
export const tenantRouter: MiddlewareHandler<HonoConfig> = async (c, next) => {
    const url = new URL(c.req.url);
    const path = url.pathname;
    const host = c.req.header('host') || '';

    // Bypass for status checks
    if (path === '/status') {
        return next();
    }

    const db = drizzle(c.env.DB);
    let tenantId: string | null = null;
    let subdomain: string | null = null;

    // Extract subdomain from host or X-Forwarded-Host header
    const forwardedHost = c.req.header('x-forwarded-host');
    const actualHost = forwardedHost || host;

    // Extract subdomain: anything before the first dot that isn't www/dev/app
    // In shared SaaS mode, hostname is "app.inspectorhub.io" — "app" is NOT a tenant subdomain
    const hostParts = actualHost.split('.');
    if (hostParts.length > 2) {
        const potentialSubdomain = hostParts[0];
        if (potentialSubdomain !== 'www' && potentialSubdomain !== 'dev' && potentialSubdomain !== 'localhost' && potentialSubdomain !== 'app') {
            subdomain = potentialSubdomain;
        }
    }

    // Check for header-based subdomain override (useful for testing/CLI)
    const headerSubdomain = c.req.header('x-tenant-subdomain');
    if (headerSubdomain) {
        subdomain = headerSubdomain;
    }

    if ((c.env.APP_MODE as string) === 'saas' && subdomain) {
        // Silo mode: resolve tenant from subdomain
        const cacheKey = `tenant:${subdomain}`;
        let cachedTenant = c.env.TENANT_CACHE ? await c.env.TENANT_CACHE.get(cacheKey, { type: 'json' }) : null;

        if (!cachedTenant) {
            const tenantMatch = await db.select().from(tenants).where(eq(tenants.subdomain, subdomain)).get();
            if (tenantMatch) {
                cachedTenant = tenantMatch;
                if (c.env.TENANT_CACHE) {
                    c.executionCtx.waitUntil(c.env.TENANT_CACHE.put(cacheKey, JSON.stringify(tenantMatch), { expirationTtl: 3600 }));
                }
            }
        }

        if (cachedTenant) {
            const cached = cachedTenant as Record<string, unknown>;
            tenantId = cached.id as string;
            c.set('tenantId', tenantId);
            c.set('resolvedTenantId', tenantId);
            c.set('requestedSubdomain', cached.subdomain as string);
            c.set('tenantTier', (cached.tier as string) || 'free');
            c.set('tenantStatus', (cached.status as string) || 'active');
        }
    } else if ((c.env.APP_MODE as string) === 'saas' && !subdomain) {
        // Shared SaaS mode (app.inspectorhub.io): tenant resolved later via JWT claims
        // Skip tenant resolution here — JWT middleware sets tenantId from token
        return next();
    } else {
        // Standalone mode
        tenantId = c.env.SINGLE_TENANT_ID || '00000000-0000-0000-0000-000000000000';
        c.set('tenantId', tenantId);

        const cacheKey = `global_tenant:${tenantId}`;
        let cachedTenant = c.env.TENANT_CACHE ? await c.env.TENANT_CACHE.get(cacheKey, { type: 'json' }) : null;

        if (!cachedTenant) {
            const tenant = await db.select().from(tenants).where(eq(tenants.id, tenantId)).get();
            if (tenant) {
                cachedTenant = tenant;
                if (c.env.TENANT_CACHE) {
                    c.executionCtx.waitUntil(c.env.TENANT_CACHE.put(cacheKey, JSON.stringify(tenant), { expirationTtl: 3600 }));
                }
            }
        }

        if (cachedTenant) {
            const t = cachedTenant as Record<string, unknown>;
            c.set('requestedSubdomain', t.subdomain as string);
            c.set('tenantTier', (t.tier as string) || 'free');
            c.set('tenantStatus', (t.status as string) || 'active');
        }
    }

    if (!c.get('tenantId') || !c.get('requestedSubdomain')) {
        const isSetupPath = path === '/setup' || path === '/login' || path === '/api/auth/setup' || path === '/api/auth/login' || path === '/status' || path.startsWith('/api/integration');
        if (!isSetupPath && path.startsWith('/api')) {
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
