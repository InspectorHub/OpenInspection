import { drizzle } from 'drizzle-orm/d1';
import { and, eq, gt, isNull, ne } from 'drizzle-orm';
import { tenantInvites, tenants, users } from '../../lib/db/schema';
import { computeSeatsHeld } from '../../lib/middleware/seat-guard';

/**
 * Tenant seat-quota usage snapshot.
 *
 * `max` mirrors the tenant's seat cap: a positive integer for capped plans,
 * or `null` for "unlimited" deployments (e.g. self-hosted standalone or a
 * future enterprise tier). The DB column `tenants.max_users` is NOT NULL
 * with a default of 3, and unlimited is currently expressed as `0` — this
 * helper normalises both `0` and a literal `null` to `max: null` so callers
 * can branch on a single shape.
 *
 * `remaining` is `Number.POSITIVE_INFINITY` whenever `max` is `null`, and
 * `Math.max(0, max - used)` otherwise. It never goes negative even if the
 * stored row count somehow exceeds the cap.
 */
export interface SeatUsage {
    /**
     * Seats HELD: members plus invitations that can still be accepted.
     *
     * This is the number a guard must reserve against. An invite that has been
     * sent and not yet accepted has already committed its seat — the person can
     * take it at any moment and nothing in between would notice — so a guard
     * that counted only members would say yes to every invite sent against one
     * free seat, and then admit all of them.
     */
    used: number;
    /**
     * Just the members: `used` minus the invitations nobody has accepted.
     *
     * Reported separately because the difference is money. A seat quantity to
     * reconcile a subscription against, or a seat count on a bill, is for the
     * people who are actually here; charging for an invitation that may never
     * be accepted is a different claim than reserving capacity for it.
     */
    members: number;
    max: number | null;
    remaining: number;
    /**
     * How much of `used` is invites nobody has accepted yet.
     *
     * Surfaced rather than folded away because a team page that lists eight
     * pending invites while three seats are charged does not add up on screen;
     * the reader needs to be able to tell which of those invites have lapsed.
     */
    pendingInvites: number;
}

/**
 * Returns the current seat usage for a tenant.
 *
 * Pure helper: takes a tenantId + a Drizzle (D1) database handle and returns
 * the usage snapshot. No DI, no env access — callers (services, middleware)
 * are responsible for resolving the DB and tenant id.
 *
 * Note on "active" filter: membership is an existing `users` row carrying
 * `tenant_id` with `deleted_at IS NULL`. Removed members (see
 * TeamService.removeMember, which soft-deletes rather than hard-deletes so
 * `inspections.inspector_id` FK attribution survives) are excluded from the
 * count — a freed seat becomes available again immediately.
 *
 * `opts.excludeInviteId` leaves one invitation out of the count. The path that
 * REDEEMS an invitation needs it: that invite is itself outstanding, so
 * counting it while checking whether its own acceptance fits would make the
 * last legitimate acceptance refuse itself.
 */
export async function getSeatUsage(
    tenantId: string,
    db: D1Database,
    opts?: { excludeInviteId?: string },
): Promise<SeatUsage> {
    const drizzleDb = drizzle(db);

    const tenantRow = await drizzleDb
        .select({ maxUsers: tenants.maxUsers })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);

    // Normalise: schema stores `max_users` NOT NULL with default 3, and uses
    // `0` to mean "unlimited". Surface both `0` and `null` as `max: null` so
    // callers see a single sentinel.
    const rawMax = tenantRow[0]?.maxUsers;
    const max: number | null = rawMax == null || rawMax <= 0 ? null : rawMax;

    // Every member counts as one seat. Defer to the shared pure helper so
    // settings-billing and the invite middleware all agree on "used".
    const rows = await drizzleDb
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.tenantId, tenantId), isNull(users.deletedAt)));

    // `expires_at > now` is not optional: the status column has no expired
    // member and nothing sweeps this table, so without the date an ignored
    // invite would hold a seat permanently. With it, the seat is released by
    // the invite's own lifetime and needs no scheduled job.
    const inviteConditions = [
        eq(tenantInvites.tenantId, tenantId),
        eq(tenantInvites.status, 'pending'),
        gt(tenantInvites.expiresAt, new Date()),
    ];
    if (opts?.excludeInviteId) {
        inviteConditions.push(ne(tenantInvites.id, opts.excludeInviteId));
    }
    const outstanding = await drizzleDb
        .select({ id: tenantInvites.id })
        .from(tenantInvites)
        .where(and(...inviteConditions));

    const used = computeSeatsHeld(rows, outstanding);
    const remaining = max === null ? Number.POSITIVE_INFINITY : Math.max(0, max - used);
    return { used, members: rows.length, max, remaining, pendingInvites: outstanding.length };
}
