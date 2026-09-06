import type { MiddlewareHandler } from 'hono';
import { eq, and } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { users, tenants } from '../db/schema';
import type { HonoConfig } from '../../types/hono';
import { getBookingHost } from '../url';
import { logger } from '../logger';
import { memoOnce } from '../request-scope';

/**
 * Sprint B-1 — populates BrandingConfig.currentUserSlug + bookingHost so
 * MainLayout can hand them to <CommandPalette /> for the "Copy my booking
 * link" action. Runs AFTER the JWT middleware (which sets c.var.user) and
 * AFTER brandingMiddleware (which sets c.var.branding). When either piece
 * is missing (un-authed page, no tenant resolved, branding still default),
 * the middleware no-ops — the palette renders without the booking action.
 *
 * A-16 — the slug lookup is now behind a 5-min KV cache keyed by user id
 * (the "if this becomes hot" plan from the original note): it ran an uncached
 * D1 read on every authenticated request. A slug change can serve the stale
 * value for up to the TTL — acceptable for a copy-link affordance.
 */
const SLUG_CACHE_TTL_S = 300;

/** Cache key for a user's booking slug — writers delete it on slug change. */
function userSlugCacheKey(userId: string): string {
    return `uslug:${userId}`;
}

/** Cache key for a tenant's slug (saas JWT-path fallback lookup). */
function tenantSlugCacheKey(tenantId: string): string {
    return `tslug:${tenantId}`;
}

export const inspectorPaletteMiddleware: MiddlewareHandler<HonoConfig> = async (c, next) => {
    const branding = c.get('branding');
    const user = c.get('user');
    const tenantId = c.get('tenantId');
    if (!branding || !user?.sub || !tenantId) {
        return await next();
    }

    try {
        // Both resolves below are memoised WHOLE, KV-hit path included, and
        // keyed by tenant as well as subject. A page render fans out into 15
        // in-process API calls that each re-enter this chain, so wrapping only
        // the D1 fallback would leave 15 KV round trips standing. Reuse inside
        // one render is strictly fresher than the 300s TTL already in force.
        const cacheKey = userSlugCacheKey(user.sub);
        // KV stores '' for "user has no slug" so the absence is cached too.
        const slug = await memoOnce(c.env, `user-slug:${tenantId}:${user.sub}`, async () => {
            const fromCache = await c.env.TENANT_CACHE?.get(cacheKey);
            if (fromCache !== null && fromCache !== undefined) return fromCache;
            const row = await drizzle(c.env.DB).select({ slug: users.slug })
                .from(users)
                .where(and(eq(users.id, user.sub), eq(users.tenantId, tenantId)))
                .get();
            const resolved = row?.slug ?? '';
            await c.env.TENANT_CACHE?.put(cacheKey, resolved, { expirationTtl: SLUG_CACHE_TTL_S });
            return resolved;
        });
        // Tenant slug: public/standalone paths set `requestedTenantSlug` via
        // tenant routing; saas AUTHENTICATED requests resolve the tenant from
        // the JWT and never set it — fall back to a cached tenants.slug lookup
        // (settings pages render slug-qualified URLs: /book/:tenant, the
        // Stripe webhook endpoint, etc.).
        let tenantSlug = c.get('requestedTenantSlug') ?? null;
        if (!tenantSlug) {
            const tKey = tenantSlugCacheKey(tenantId);
            // A separate resolve from the user slug above, not the same lookup
            // narrowed -- different table, different key namespace.
            const cached = await memoOnce(c.env, `tenant-slug:${tenantId}`, async () => {
                const fromCache = await c.env.TENANT_CACHE?.get(tKey);
                if (fromCache !== null && fromCache !== undefined) return fromCache;
                const row = await drizzle(c.env.DB).select({ slug: tenants.slug })
                    .from(tenants)
                    .where(eq(tenants.id, tenantId))
                    .get();
                const resolved = row?.slug ?? '';
                await c.env.TENANT_CACHE?.put(tKey, resolved, { expirationTtl: SLUG_CACHE_TTL_S });
                return resolved;
            });
            tenantSlug = cached || null;
        }

        const enriched = {
            ...branding,
            currentUserSlug: slug || null,
            bookingHost:     getBookingHost(c),
            tenantSlug,
        };
        c.set('branding', enriched);
    } catch (e) {
        logger.warn('[inspector-palette] slug lookup failed', { userId: user.sub, error: (e as Error).message });
    }
    await next();
};
