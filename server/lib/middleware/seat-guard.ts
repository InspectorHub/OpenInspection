/**
 * Unified seat-quota helpers.
 *
 * Every member counts as one seat against `tenants.max_users`. These pure
 * helpers can be unit-tested without a DB; the route-mounted middleware in
 * `server/features/seat-quota/middleware` composes `getSeatUsage` (which
 * defers to `computeSeatsUsed`) with the profile gate.
 */

/** Local to this file since `summariseSeats` stopped taking rows — the only
 *  caller of `computeSeatsUsed` is now `getSeatUsage`, which owns the query. */
interface SeatUser {
    id: string;
}

/**
 * Count the seats held by `users`. Every member counts once.
 */
export function computeSeatsUsed(users: SeatUser[]): number {
    return users.length;
}

/**
 * Seats a tenant is HOLDING: its members plus the invites it has sent that
 * have neither been accepted nor lapsed.
 *
 * A separate function from `computeSeatsUsed` rather than a wider version of
 * it, because the two answer different questions and both still have callers:
 * a bill is for the people who are here, while a quota guard has to reserve
 * against every seat that can still be claimed without anything noticing.
 */
export function computeSeatsHeld(activeUsers: SeatUser[], outstandingInvites: SeatUser[]): number {
    return computeSeatsUsed(activeUsers) + outstandingInvites.length;
}

/**
 * True when `seatsUsed >= maxUsers`. A tenant with `max_users === 0` is
 * always blocked — used by tests to assert the hard-stop branch.
 */
export function isAtOrOverQuota(seatsUsed: number, maxUsers: number): boolean {
    return seatsUsed >= maxUsers;
}
