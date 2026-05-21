import type { MiddlewareHandler } from 'hono';
import type { HonoConfig } from '../../types/hono';
import { Errors } from '../../lib/errors';
import { getSeatUsage } from './usage';

/**
 * Guards POST /api/team/invite (and any other seat-allocating route it is
 * mounted on). The middleware is intended to be mounted unconditionally:
 * when the active deployment profile has no seat-quota enforcement
 * (standalone, saas-silo) it short-circuits to `next()` without
 * touching the database.
 *
 * When seat enforcement IS active (saas-shared today), it calls
 * `getSeatUsage` and throws `Errors.SeatLimitReached` (HTTP 402) once the
 * tenant's remaining seat count reaches zero. The error payload carries
 * the current `used` / `max` counts and the profile's `billingPortalUrl`
 * so the client can surface an "upgrade" CTA without an extra round-trip.
 */
export const requireSeatAvailable: MiddlewareHandler<HonoConfig> = async (c, next) => {
    if (!c.var.profile.hasSeatQuota) return next();

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
