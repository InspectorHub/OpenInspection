import type { Context } from 'hono';
import type { HonoConfig } from '../types/hono';
import { Errors } from './errors';

/**
 * Check the Cloudflare Rate Limiter for the given prefix + CF-Connecting-IP key.
 * No-ops when RATE_LIMITER binding is absent (local dev).
 * Throws RateLimited if the limit is exceeded.
 */
export async function checkRateLimit(c: Context<HonoConfig>, prefix: string): Promise<void> {
    if (!c.env.RATE_LIMITER) return;
    const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
    const { success } = await c.env.RATE_LIMITER.limit({ key: `${prefix}:${ip}` });
    if (!success) throw Errors.RateLimited();
}
