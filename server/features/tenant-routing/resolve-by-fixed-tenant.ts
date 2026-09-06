import type { Context } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenants } from '../../lib/db/schema';
import type { HonoConfig } from '../../types/hono';
import { memoOnce } from '../../lib/request-scope';

/**
 * Standalone path: fixed tenant id from profile, with KV cache
 * for the row metadata (slug / tier / status).
 */
export async function resolveByFixedTenant(c: Context<HonoConfig>, tenantId: string): Promise<void> {
    c.set('tenantId', tenantId);

    const cacheKey = `global_tenant:${tenantId}`;

    // Memoised across the in-process API fan-out: one page render re-enters the
    // global middleware chain 15 times, and this row read was 1 of the 10 D1
    // statements every one of those passes paid. The whole KV-then-D1 resolve
    // is inside, so the repeat KV round trips go too. Reuse within a single
    // render is strictly fresher than the 3600s TTL already in force here.
    const cachedTenant = await memoOnce(c.env, `tenant-row:${tenantId}`, async (): Promise<unknown> => {
        const fromCache = c.env.TENANT_CACHE ? await c.env.TENANT_CACHE.get(cacheKey, { type: 'json' }) : null;
        if (fromCache) return fromCache;

        try {
            const db = drizzle(c.env.DB);
            const tenant = await db.select().from(tenants).where(eq(tenants.id, tenantId)).get();
            if (tenant) {
                if (c.env.TENANT_CACHE && c.executionCtx) {
                    c.executionCtx.waitUntil(c.env.TENANT_CACHE.put(cacheKey, JSON.stringify(tenant), { expirationTtl: 3600 }));
                }
                return tenant;
            }
        } catch {
            // DB unavailable / not yet provisioned — leave metadata unset, tenantId
            // is already populated from the profile so downstream still functions.
        }
        return null;
    });

    if (cachedTenant) {
        const t = cachedTenant as Record<string, unknown>;
        c.set('requestedTenantSlug', t.slug as string);
        c.set('tenantTier', (t.tier as string) || 'free');
        c.set('tenantStatus', (t.status as string) || 'active');
    }
}
