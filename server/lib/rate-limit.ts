import type { Context } from 'hono';
import type { HonoConfig } from '../types/hono';
import { Errors } from './errors';
import { logger } from './logger';
import { normalizeAddress } from './network-address';
import { PAGE_RENDER_CALL } from './request-scope';

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
export type RateLimiterName = 'RATE_LIMITER' | 'QBO_WEBHOOK_RATE_LIMITER' | 'STRIPE_WEBHOOK_RATE_LIMITER' | 'OAUTH_TOKEN_RATE_LIMITER';

/** The binding limiters' shape, as a plain environment (a caller outside a Hono context has no `c`). */
interface LimiterEnv {
    RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
    QBO_WEBHOOK_RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
    STRIPE_WEBHOOK_RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
    OAUTH_TOKEN_RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
    DISABLE_RATE_LIMIT?: string;
}

/**
 * True when the call is within the limit. The same decision `checkRateLimit` makes, for code that has an environment but no request
 * context (the OAuth provider wrapper). An absent binding, or the test escape hatch, allows.
 */
export async function withinRateLimit(env: LimiterEnv, prefix: string, who: string, limiter: RateLimiterName = 'RATE_LIMITER'): Promise<boolean> {
    // Named reads, not `env[limiter]`: a computed key hides the property from the unread-field gate and from anyone grepping for who uses a binding.
    const binding = limiter === 'QBO_WEBHOOK_RATE_LIMITER' ? env.QBO_WEBHOOK_RATE_LIMITER
        : limiter === 'STRIPE_WEBHOOK_RATE_LIMITER' ? env.STRIPE_WEBHOOK_RATE_LIMITER
        : limiter === 'OAUTH_TOKEN_RATE_LIMITER' ? env.OAUTH_TOKEN_RATE_LIMITER
        : env.RATE_LIMITER;
    if (!binding) return true;
    if (env.DISABLE_RATE_LIMIT === '1') return true;
    // An address counts as its network (an IPv6 caller as its /64), so rotating inside one subscriber's range does not mint a fresh
    // allowance. A non-address key (a tenant or inspection id) passes through unchanged apart from case.
    const { success } = await binding.limit({ key: `${prefix}:${normalizeAddress(who)}` });
    return success;
}

export async function checkRateLimit(
    c: Context<HonoConfig>, prefix: string, scope?: string, limiter: RateLimiterName = 'RATE_LIMITER',
): Promise<void> {
    // The escape hatch DISABLE_RATE_LIMIT (defaults to enforced): the seeded E2E suite drives ~140 specs' logins from a single runner IP,
    // which blows past the 10/60s login limiter and 429s beforeAll hooks flakily. Only the ephemeral E2E .dev.vars sets it; production
    // and self-host never do. An absent binding is a no-op (local dev).
    const address = c.req.header('CF-Connecting-IP');
    // A page's loader or action reaches the API through the in-process binding, which must hand the visitor's address on (see
    // workers/inprocess-request.ts). If it did not, every visitor would share one 'unknown' bucket and a few junk calls would lock
    // everyone out, so say so loudly rather than limiting silently.
    if (!scope && !address && (c.env as unknown as Record<string, unknown>)[PAGE_RENDER_CALL] === true && c.env.DISABLE_RATE_LIMIT !== '1') {
        logger.warn('[rate-limit] in-process call without a client address; every caller shares one bucket', { prefix });
    }
    const who = scope ?? address ?? 'unknown';
    if (!await withinRateLimit(c.env, prefix, who, limiter)) throw Errors.RateLimited();
}
