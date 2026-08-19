/**
 * The seat check that runs when the seat is actually TAKEN.
 *
 * `requireSeatAvailable` (middleware.ts) guards POST /api/team/invite, and it
 * now reserves against outstanding invitations too — so it no longer says yes
 * to twelve invites sent against one free seat. Issuing and redeeming are still
 * separate moments, and this is the second one: an invitation written before
 * that reservation existed, one whose seat was freed by an unrelated expiry,
 * and two people accepting at the same instant all arrive here having passed an
 * issue-time check that is no longer true. The seat moves in
 * `AuthService.joinTeam`, which is what this guards.
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
 *
 * `inviteId` is REQUIRED, and it is the invite being redeemed. `getSeatUsage`
 * counts outstanding invitations as held seats, so this one is already in the
 * total that is about to be tested against the cap — leaving it in would make
 * the last legitimate acceptance refuse itself, every time. A parameter the
 * caller cannot forget is the only version of that exclusion that stays true.
 */
export async function assertSeatAvailableForJoin(
    tenantId: string,
    db: D1Database,
    seatQuota: SeatQuotaContext,
    inviteId: string,
): Promise<void> {
    if (!seatQuota.enforce) return;

    const usage = await getSeatUsage(tenantId, db, { excludeInviteId: inviteId });
    if (usage.remaining <= 0) {
        throw Errors.SeatLimitReached({
            used: usage.used,
            max: usage.max ?? 0,
            billingPortalUrl: seatQuota.billingPortalUrl,
        });
    }
}
