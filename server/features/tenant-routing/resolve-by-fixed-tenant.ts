import type { Context } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenants } from '../../lib/db/schema';
import type { HonoConfig } from '../../types/hono';

/**
 * Standalone path: fixed tenant id from profile, with KV cache
 * for the row metadata (slug / tier / status).
 */
export async function resolveByFixedTenant(c: Context<HonoConfig>, tenantId: string): Promise<void> {
    c.set('tenantId', tenantId);

    const cacheKey = `global_tenant:${tenantId}`;
    let cachedTenant = c.env.TENANT_CACHE ? await c.env.TENANT_CACHE.get(cacheKey, { type: 'json' }) : null;

    if (!cachedTenant) {
        try {
            const db = drizzle(c.env.DB);
            const tenant = await db.select().from(tenants).where(eq(tenants.id, tenantId)).get();
            if (tenant) {
                cachedTenant = tenant;
                if (c.env.TENANT_CACHE && c.executionCtx) {
                    c.executionCtx.waitUntil(c.env.TENANT_CACHE.put(cacheKey, JSON.stringify(tenant), { expirationTtl: 3600 }));
                }
            }
        } catch {
            // DB unavailable / not yet provisioned — leave metadata unset, tenantId
            // is already populated from the profile so downstream still functions.
        }
    }

    if (cachedTenant) {
        const t = cachedTenant as Record<string, unknown>;
        c.set('requestedTenantSlug', t.slug as string);
        c.set('tenantTier', (t.tier as string) || 'free');
        c.set('tenantStatus', (t.status as string) || 'active');
    }
}
