import { MiddlewareHandler } from 'hono';
import { eq, and } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { users, tenants } from '../db/schema';
import { HonoConfig } from '../../types/hono';
import { getBookingHost } from '../url';
import { logger } from '../logger';

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
export function userSlugCacheKey(userId: string): string {
    return `uslug:${userId}`;
}

/** Cache key for a tenant's slug (saas JWT-path fallback lookup). */
export function tenantSlugCacheKey(tenantId: string): string {
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
        const cacheKey = userSlugCacheKey(user.sub);
        // KV stores '' for "user has no slug" so the absence is cached too.
        let slug = await c.env.TENANT_CACHE?.get(cacheKey);
        if (slug === null || slug === undefined) {
            const row = await drizzle(c.env.DB).select({ slug: users.slug })
                .from(users)
                .where(and(eq(users.id, user.sub), eq(users.tenantId, tenantId)))
                .get();
            slug = row?.slug ?? '';
            await c.env.TENANT_CACHE?.put(cacheKey, slug, { expirationTtl: SLUG_CACHE_TTL_S });
        }
        // Tenant slug: public/standalone paths set `requestedTenantSlug` via
        // tenant routing; saas AUTHENTICATED requests resolve the tenant from
        // the JWT and never set it — fall back to a cached tenants.slug lookup
        // (settings pages render slug-qualified URLs: /book/:tenant, the
        // Stripe webhook endpoint, etc.).
        let tenantSlug = c.get('requestedTenantSlug') ?? null;
        if (!tenantSlug) {
            const tKey = tenantSlugCacheKey(tenantId);
            let cached = await c.env.TENANT_CACHE?.get(tKey);
            if (cached === null || cached === undefined) {
                const row = await drizzle(c.env.DB).select({ slug: tenants.slug })
                    .from(tenants)
                    .where(eq(tenants.id, tenantId))
                    .get();
                cached = row?.slug ?? '';
                await c.env.TENANT_CACHE?.put(tKey, cached, { expirationTtl: SLUG_CACHE_TTL_S });
            }
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
