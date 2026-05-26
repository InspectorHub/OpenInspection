import { MiddlewareHandler } from 'hono';
import { eq, and } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { users } from '../db/schema';
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
 * Slug lookup is per-request and uncached because users.slug rarely reads
 * but the value must be authoritative when it does (a stale slug → broken
 * link in the user's clipboard). If this becomes hot, swap to a 5-min KV
 * cache keyed by user id.
 */
export const inspectorPaletteMiddleware: MiddlewareHandler<HonoConfig> = async (c, next) => {
    const branding = c.get('branding');
    const user = c.get('user');
    const tenantId = c.get('tenantId');
    if (!branding || !user?.sub || !tenantId) {
        return await next();
    }

    try {
        const row = await drizzle(c.env.DB).select({ slug: users.slug })
            .from(users)
            .where(and(eq(users.id, user.sub), eq(users.tenantId, tenantId)))
            .get();
        const enriched = {
            ...branding,
            currentUserSlug: row?.slug ?? null,
            bookingHost:     getBookingHost(c),
            tenantSubdomain: c.get('requestedSubdomain') ?? null,
        };
        c.set('branding', enriched);
    } catch (e) {
        logger.warn('[inspector-palette] slug lookup failed', { userId: user.sub, error: (e as Error).message });
    }
    await next();
};
