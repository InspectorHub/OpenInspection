/**
 * The seat check that runs when the seat is actually TAKEN.
 *
 * `requireSeatAvailable` (middleware.ts) guards POST /api/team/invite, and it
 * counts ACTIVE members. A pending invite holds no seat, so at one free seat
 * that guard says yes to every invite an owner sends — the cap is checked N
 * times against a number that has not moved, and never at the moment it moves.
 * It moves in `AuthService.joinTeam`, which is what this guards.
 *
 * It lives here rather than in the service so both halves of the invitation
 * read "used" from the same helper (`getSeatUsage`, i.e. `deleted_at IS NULL`),
 * and so the seat vocabulary stays in one feature directory.
 */
import { Errors } from '../../lib/errors';
import { getSeatUsage } from './usage';

/**
 * Whether THIS deployment charges for seats, and where to send someone who
 * needs another one. Resolved by the route from `c.var.profile` — the service
 * layer has no context and must not guess: `tenants.max_users` is NOT NULL
 * with a schema default, so code that always enforced would cap self-hosted
 * installs at that default with no billing page to escape to.
 */
export interface SeatQuotaContext {
    enforce: boolean;
    billingPortalUrl: string | null;
}

/** The standalone / self-hosted answer, and the one tests state explicitly. */
export const SEAT_QUOTA_UNENFORCED: SeatQuotaContext = { enforce: false, billingPortalUrl: null };

/**
 * Throws `Errors.SeatLimitReached` (HTTP 402) when the tenant has no seat left.
 * A no-op when the deployment does not enforce seats — and it does NOT read the
 * database in that case, which is what keeps standalone free of the query.
 *
 * Call it before anything is written and before the invite token is burned: a
 * refusal must leave the invitation usable once a seat is freed.
 */
export async function assertSeatAvailableForJoin(
    tenantId: string,
    db: D1Database,
    seatQuota: SeatQuotaContext,
): Promise<void> {
    if (!seatQuota.enforce) return;

    const usage = await getSeatUsage(tenantId, db);
    if (usage.remaining <= 0) {
        throw Errors.SeatLimitReached({
            used: usage.used,
            max: usage.max ?? 0,
            billingPortalUrl: seatQuota.billingPortalUrl,
        });
    }
}
