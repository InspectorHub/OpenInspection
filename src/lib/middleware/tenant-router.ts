import { MiddlewareHandler } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenants } from '../db/schema';
import { HonoConfig } from '../../types/hono';

/**
 * Middleware to resolve the global workspace.
 * Sets the 'tenantId' and other context variables for the single-tenant engine.
 */
export const tenantRouter: MiddlewareHandler<HonoConfig> = async (c, next) => {
    const url = new URL(c.req.url);
    const path = url.pathname;
    
    // Bypass for status checks
    if (path === '/status') {
        return next();
    }

    const db = drizzle(c.env.DB);

    // Global Workspace Identification
    // Default system ID: 00000000-0000-0000-0000-000000000000
    const tenantId = c.env.SINGLE_TENANT_ID || '00000000-0000-0000-0000-000000000000';
    c.set('tenantId', tenantId);

    let tenant: typeof tenants.$inferSelect | null = null;
    const cacheKey = `global_tenant:${tenantId}`;
    
    if (c.env.TENANT_CACHE) {
        tenant = await c.env.TENANT_CACHE.get(cacheKey, { type: 'json' });
    }

    if (!tenant) {
        tenant = await db.select().from(tenants).where(eq(tenants.id, tenantId)).get() || null;
        
        if (!tenant) {
            // Self-healing: system must be initialized via web setup or CLI.
            const isSetupPath = path === '/setup' || path === '/api/auth/setup';
            if (!isSetupPath && (path === '/' || path.startsWith('/dashboard') || path === '/book' || path === '/team' || path === '/settings')) {
                return c.redirect('/setup');
            }
            
            if (!isSetupPath && path.startsWith('/api')) {
                return c.text('System not initialized. Please visit /setup to initialize the global workspace.', 503);
            }

            return next();
        }

        if (c.env.TENANT_CACHE) {
            c.executionCtx.waitUntil(c.env.TENANT_CACHE.put(cacheKey, JSON.stringify(tenant), { expirationTtl: 3600 }));
        }
    }

    if (tenant) {
        c.set('tenantTier', tenant.tier || 'free');
        c.set('tenantStatus', tenant.status || 'active');
    }

    return next();
};
