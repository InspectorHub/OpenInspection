import type { Context } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenants, tenantSlugHistory } from '../../lib/db/schema';
import type { HonoConfig } from '../../types/hono';

/**
 * Path-param resolution: pulls the tenant slug from the URL's first
 * non-prefix segment for known public routes, then resolves via KV/D1
 * the same way slug resolution does.
 *
 * Pattern: /<prefix>/<tenant>/...
 *   prefix ∈ {book, inspector, report, report-view, sign,
 *             agreements/sign, checkout, m2m/agreement-render,
 *             webhooks/stripe, api/portal, portal}
 *
 * Returns true if a tenant was extracted + resolved; false otherwise
 * (caller should then try slug → fixed → leave-unset).
 */
// `/embed/book/` was removed: the only embed URL this app mints is
// `/embed/{tenant}` (server/lib/public-urls.ts, embedBookingCompanyUrl), so that
// prefix could never match, and the embed page resolves its tenant by calling
// `/api/public/book/:tenant` anyway. A prefix that cannot match is not harmless
// here — it reads as documentation of a URL shape that does not exist.
const PUBLIC_PREFIXES = [
    '/book/',
    '/inspector/',
    '/report-view/',
    '/report/',
    '/sign/',
    '/agreements/sign/',
    '/checkout/',
    '/m2m/agreement-render/',
    // Stripe's tenant-scoped inbound webhook. The tenant must be resolved from
    // the path BEFORE the signature can be verified, because the verifier secret
    // (whsec) is per-tenant.
    '/webhooks/stripe/',
    // Unified client portal — API routes (this task) + page routes (later task).
    '/api/portal/',
    '/portal/',
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

    // A slug this tenant USED to have. Consulted ONLY here, after the live
    // lookup missed, so a live tenant can never be shadowed by history — if
    // somebody has since claimed this slug, the query above already resolved
    // them and we never reach this line.
    //
    // Deliberately NOT bounded by `retired_until`: that window governs
    // re-registration, not resolution. Past it, an unclaimed slug still reaching
    // its original owner is strictly better than a 404, and a claimed one is
    // handled by the live lookup above.
    //
    // Guarded on `fixedTenantId`: standalone never writes this table, and its
    // fixed-tenant fallthrough already resolves any slug in the URL, so the read
    // would be pure cost on the hottest unauthenticated path in the product.
    //
    // Not cached. The KV entry above is keyed on the REQUESTED slug, so warming
    // it from a history hit would serve the previous owner to whoever later
    // claims that slug — for a full TTL, invisibly. `portal.provider.ts` does
    // drop `tenant:<slug>` on every sync, which covers the claim; leaving the
    // history path uncached means there is nothing to get stale in between.
    if (!cachedTenant && !c.var.profile?.fixedTenantId) {
        try {
            const db = drizzle(c.env.DB);
            const prior = await db
                .select({ tenantId: tenantSlugHistory.tenantId })
                .from(tenantSlugHistory)
                .where(eq(tenantSlugHistory.oldSlug, tenantSlug))
                .get();
            if (prior) {
                const owner = await db.select().from(tenants)
                    .where(eq(tenants.id, prior.tenantId)).get();
                if (owner) cachedTenant = owner;
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
