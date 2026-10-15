import type { Context } from 'hono';
import type { HonoConfig } from '../types/hono';
import { Errors } from './errors';

/**
 * Check the Cloudflare Rate Limiter for the given prefix + CF-Connecting-IP key.
 * No-ops when RATE_LIMITER binding is absent (local dev).
 * Throws RateLimited if the limit is exceeded.
 * `scope` replaces the client IP in the key (e.g. a tenant id) so a limit can be
 * shared by everyone acting for one workspace.
 */
/**
 * A Cloudflare rate-limit binding carries ONE fixed limit/period in its wrangler
 * config, so a route that needs a different ceiling than the 10/60s default names
 * its own binding here. An absent binding is a no-op, like the default one.
 */
export type RateLimiterName = 'RATE_LIMITER' | 'QBO_WEBHOOK_RATE_LIMITER' | 'STRIPE_WEBHOOK_RATE_LIMITER';

export async function checkRateLimit(
    c: Context<HonoConfig>, prefix: string, scope?: string, limiter: RateLimiterName = 'RATE_LIMITER',
): Promise<void> {
    // Named reads, not `c.env[limiter]`: a computed key hides the property from
    // the unread-field gate and from anyone grepping for who uses a binding.
    const binding = limiter === 'QBO_WEBHOOK_RATE_LIMITER' ? c.env.QBO_WEBHOOK_RATE_LIMITER
        : limiter === 'STRIPE_WEBHOOK_RATE_LIMITER' ? c.env.STRIPE_WEBHOOK_RATE_LIMITER
        : c.env.RATE_LIMITER;
    if (!binding) return;
    // Test/dev escape hatch (defaults to enforced): the seeded E2E suite drives
    // ~140 specs' logins from a single runner IP, which blows past the 10/60s
    // login limiter and 429s beforeAll hooks flakily. Only the ephemeral E2E
    // .dev.vars sets this; production and self-host never do.
    if (c.env.DISABLE_RATE_LIMIT === '1') return;
    const who = scope ?? c.req.header('CF-Connecting-IP') ?? 'unknown';
    const { success } = await binding.limit({ key: `${prefix}:${who}` });
    if (!success) throw Errors.RateLimited();
}
