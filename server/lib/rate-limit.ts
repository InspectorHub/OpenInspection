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
    // Test/dev escape hatch (defaults to enforced): the seeded E2E suite drives
    // ~140 specs' logins from a single runner IP, which blows past the 10/60s
    // login limiter and 429s beforeAll hooks flakily. Only the ephemeral E2E
    // .dev.vars sets this; production and self-host never do.
    if (c.env.DISABLE_RATE_LIMIT === '1') return;
    const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
    const { success } = await c.env.RATE_LIMITER.limit({ key: `${prefix}:${ip}` });
    if (!success) throw Errors.RateLimited();
}
