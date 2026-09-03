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
    if (c.env.APP_BASE_URL) return c.env.APP_BASE_URL.replace(/\/$/, '');
    const hostHdr = c.req.header('host');
    try {
        const u = new URL(c.req.url);
        // Host header reflects the browser-facing host when present. Fall back
        // to the request URL origin (includes port) — never bare "localhost".
        if (hostHdr) return `${u.protocol}//${hostHdr}`;
        if (u.host) return u.origin;
    } catch { /* fall through */ }
    const protocol = c.req.url.startsWith('https') ? 'https' : 'http';
    return `${protocol}://${hostHdr || 'localhost'}`;
}

/**
 * The one accept URL for an invitation.
 *
 * There is exactly one of these per invite and several places that need it —
 * the create response, the email, the resend, the roster's "Invite link"
 * dialog, the admin console and the roster import. Composed by hand in each,
 * they drifted the moment one of them used a different base: a screen that
 * pasted its own browser origin in front of the token produced a SECOND URL
 * for one invitation, and on any deployment reached at an address other than
 * its configured base that second URL is the one that does not work.
 *
 * The token is `tenant_invites.id` — a uuid today, so the encoding is a no-op
 * on every value that currently reaches here. It is applied anyway because
 * this function is the boundary between an id and a URL, and that is where a
 * value stops being safe by inspection.
 */
export function inviteAcceptUrl(c: Context<HonoConfig>, token: string): string {
    return `${getBaseUrl(c)}/join?token=${encodeURIComponent(token)}`;
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
