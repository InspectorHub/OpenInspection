import type { Context } from 'hono';
import type { HonoConfig } from '../types/hono';

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
