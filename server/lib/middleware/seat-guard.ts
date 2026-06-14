/**
 * Unified seat-quota helpers.
 *
 * Every member counts as one seat against `tenants.max_users`. These pure
 * helpers can be unit-tested without a DB; the route-mounted middleware in
 * `server/features/seat-quota/middleware` composes `getSeatUsage` (which
 * defers to `computeSeatsUsed`) with the profile gate.
 */

export interface SeatUser {
    id: string;
}

/**
 * Count the seats held by `users`. Every member counts once.
 */
export function computeSeatsUsed(users: SeatUser[]): number {
    return users.length;
}

/**
 * True when `seatsUsed >= maxUsers`. A tenant with `max_users === 0` is
 * always blocked — used by tests to assert the hard-stop branch.
 */
export function isAtOrOverQuota(seatsUsed: number, maxUsers: number): boolean {
    return seatsUsed >= maxUsers;
}
