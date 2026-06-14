import type { Context } from 'hono';
import type { HonoConfig } from '../types/hono';
import { drizzle } from 'drizzle-orm/d1';
import { tenants } from './db/schema';
import { eq } from 'drizzle-orm';

/**
 * Public tenant slug for building report links + headless render URLs. saas
 * AUTHENTICATED routes resolve the tenant from the JWT and never set
 * requestedTenantSlug, so fall back to a tenants.slug lookup by the verified
 * tenantId (mirrors the hubRoute pattern). An empty slug yields /report-view//:id
 * which 404s — fatal for the headless PDF render — so this fallback is mandatory.
 */
export async function resolveTenantSlug(c: Context<HonoConfig>, tenantId: string): Promise<string> {
    const fromCtx = c.get('requestedTenantSlug');
    if (fromCtx) return fromCtx;
    const row = await drizzle(c.env.DB).select({ slug: tenants.slug })
        .from(tenants).where(eq(tenants.id, tenantId)).get();
    return row?.slug ?? '';
}

/**
 * Builds the base URL (protocol + host) from the current request context.
 * Prefers the APP_BASE_URL env var when set.
 */
export function getBaseUrl(c: Context<HonoConfig>): string {
    if (c.env.APP_BASE_URL) return c.env.APP_BASE_URL;
    const protocol = c.req.url.startsWith('https') ? 'https' : 'http';
    const host = c.req.header('host') || 'localhost';
    return `${protocol}://${host}`;
}

/**
 * Sprint B-4 — extract the bare host (no protocol, no path) for use in
 * inspectorSignature() which builds `https://{host}/book/{slug}` links.
 * Mirrors getBaseUrl preference: APP_BASE_URL wins, falls back to the
 * request's Host header.
 */
export function getBookingHost(c: Context<HonoConfig>): string {
    if (c.env.APP_BASE_URL) {
        try { return new URL(c.env.APP_BASE_URL).host; } catch { /* fall through */ }
    }
    return c.req.header('host') || 'localhost';
}
