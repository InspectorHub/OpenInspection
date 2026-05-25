import type { Context } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenants } from '../../lib/db/schema';
import type { HonoConfig } from '../../types/hono';

/**
 * Silo path: tenant resolved from request subdomain. Same KV cache key
 * naming and TTL as the prior tenant-router.ts implementation.
 */
export async function resolveBySubdomain(c: Context<HonoConfig>, subdomain: string): Promise<void> {
    const cacheKey = `tenant:${subdomain}`;
    let cachedTenant = c.env.TENANT_CACHE ? await c.env.TENANT_CACHE.get(cacheKey, { type: 'json' }) : null;

    if (!cachedTenant) {
        const db = drizzle(c.env.DB);
        const tenantMatch = await db.select().from(tenants).where(eq(tenants.subdomain, subdomain)).get();
        if (tenantMatch) {
            cachedTenant = tenantMatch;
            if (c.env.TENANT_CACHE && c.executionCtx) {
                c.executionCtx.waitUntil(c.env.TENANT_CACHE.put(cacheKey, JSON.stringify(tenantMatch), { expirationTtl: 3600 }));
            }
        }
    }

    if (cachedTenant) {
        const cached = cachedTenant as Record<string, unknown>;
        const tenantId = cached.id as string;
        c.set('tenantId', tenantId);
        c.set('resolvedTenantId', tenantId);
        c.set('requestedSubdomain', cached.subdomain as string);
        c.set('tenantTier', (cached.tier as string) || 'free');
        c.set('tenantStatus', (cached.status as string) || 'active');
    }
}
