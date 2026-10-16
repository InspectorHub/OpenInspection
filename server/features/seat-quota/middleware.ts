import type { MiddlewareHandler } from 'hono';
import type { HonoConfig } from '../../types/hono';
import { Errors } from '../../lib/errors';
import { getSeatUsage } from './usage';
import { holdsSeat } from '../../lib/middleware/seat-guard';

/**
 * The role named in the request body, read from a CLONE so the handler's own
 * validation still sees an unread body. Null when it cannot be read, in which
 * case the caller applies the seat check as if the role held a seat.
 */
async function requestedRole(c: Parameters<MiddlewareHandler<HonoConfig>>[0]): Promise<string | null> {
    try {
        const body: unknown = await c.req.raw.clone().json();
        const role = body !== null && typeof body === 'object' ? (body as { role?: unknown }).role : undefined;
        return typeof role === 'string' ? role : null;
    } catch {
        return null;
    }
}

/**
 * Guards POST /api/team/invite (and any other seat-allocating route it is
 * mounted on). The middleware is intended to be mounted unconditionally:
 * when the active deployment profile has no seat-quota enforcement
 * (standalone, saas-silo) it short-circuits to `next()` without
 * touching the database. A request that names a role holding no seat
 * (`countsTowardSeatQuota`) skips the check too.
 *
 * When seat enforcement IS active (saas-shared today), it calls
 * `getSeatUsage` and throws `Errors.SeatLimitReached` (HTTP 402) once the
 * tenant's remaining seat count reaches zero. The error payload carries
 * the current `used` / `max` counts and the profile's `billingPortalUrl`
 * so the client can surface an "upgrade" CTA without an extra round-trip.
 */
export const requireSeatAvailable: MiddlewareHandler<HonoConfig> = async (c, next) => {
    if (!c.var.profile.hasSeatQuota) return next();

    // A role that holds no seat can be invited at the limit. Only a readable,
    // recognised role skips the check; anything else is counted.
    const role = await requestedRole(c);
    if (role !== null && !holdsSeat(role)) return next();

    const tenantId = c.get('tenantId');
    if (!tenantId) throw Errors.Unauthorized('Tenant context missing');

    const usage = await getSeatUsage(tenantId, c.env.DB);

    if (usage.remaining <= 0) {
        throw Errors.SeatLimitReached({
            used: usage.used,
            max: usage.max ?? 0,
            billingPortalUrl: c.var.profile.billingPortalUrl,
        });
    }

    return next();
};
