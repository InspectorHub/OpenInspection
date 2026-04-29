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
