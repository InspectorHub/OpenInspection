import type { Context } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenants } from '../../lib/db/schema';
import type { HonoConfig } from '../../types/hono';

/**
 * Path-param resolution: pulls the tenant slug from the URL's first
 * non-prefix segment for known public routes, then resolves via KV/D1
 * the same way slug resolution does.
 *
 * Pattern: /<prefix>/<tenant>/...
 *   prefix ∈ {book, embed/book, inspector, report, sign,
 *             agreements/sign, m2m/agreement-render}
 *
 * Returns true if a tenant was extracted + resolved; false otherwise
 * (caller should then try slug → fixed → leave-unset).
 */
const PUBLIC_PREFIXES = [
    '/book/',
    '/embed/book/',
    '/inspector/',
    '/report/',
    '/sign/',
    '/agreements/sign/',
    '/m2m/agreement-render/',
    '/api/integrations/stripe/webhook/',
];

export async function resolveByPathParam(c: Context<HonoConfig>, path: string): Promise<boolean> {
    let tenantSlug: string | null = null;
    for (const prefix of PUBLIC_PREFIXES) {
        if (path.startsWith(prefix)) {
            const rest = path.slice(prefix.length);
            tenantSlug = rest.split('/')[0] ?? null;
            break;
        }
    }
    if (!tenantSlug) return false;

    const cacheKey = `tenant:${tenantSlug}`;
    let cachedTenant = c.env.TENANT_CACHE ? await c.env.TENANT_CACHE.get(cacheKey, { type: 'json' }) : null;

    if (!cachedTenant) {
        try {
            const db = drizzle(c.env.DB);
            const tenantMatch = await db.select().from(tenants).where(eq(tenants.slug, tenantSlug)).get();
            if (tenantMatch) {
                cachedTenant = tenantMatch;
                if (c.env.TENANT_CACHE && c.executionCtx) {
                    c.executionCtx.waitUntil(c.env.TENANT_CACHE.put(cacheKey, JSON.stringify(tenantMatch), { expirationTtl: 3600 }));
                }
            }
        } catch {
            // DB unavailable in test contexts — fall through to "not resolved"
        }
    }

    if (!cachedTenant) return false;

    const cached = cachedTenant as Record<string, unknown>;
    const tenantId = cached.id as string;
    c.set('tenantId', tenantId);
    c.set('resolvedTenantId', tenantId);
    c.set('requestedTenantSlug', cached.slug as string);
    c.set('tenantTier', (cached.tier as string) || 'free');
    c.set('tenantStatus', (cached.status as string) || 'active');
    return true;
}
