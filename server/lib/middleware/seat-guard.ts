/**
 * Unified seat-quota helpers.
 *
 * Seat accounting is decided in one function, `countsTowardSeatQuota`
 * (`auth/roles`); every other member counts as one seat against
 * `tenants.max_users`. These pure
 * helpers can be unit-tested without a DB; the route-mounted middleware in
 * `server/features/seat-quota/middleware` composes `getSeatUsage` (which
 * defers to `computeSeatsUsed`) with the profile gate.
 */

import { countsTowardSeatQuota, isRole } from '../auth/roles';

/** Local to this file since `summariseSeats` stopped taking rows — the only
 *  caller of `computeSeatsUsed` is now `getSeatUsage`, which owns the query. */
interface SeatUser {
    id: string;
    role: string;
}

/**
 * True when a person with this stored role holds a seat. A role this build does
 * not know counts, so an unrecognised value can never shrink the bill.
 */
export function holdsSeat(role: string): boolean {
    return !isRole(role) || countsTowardSeatQuota(role);
}

/**
 * Count the seats held by `users`. Every member counts once, except the roles
 * `countsTowardSeatQuota` excludes.
 */
export function computeSeatsUsed(users: SeatUser[]): number {
    return users.filter((u) => holdsSeat(u.role)).length;
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
    return computeSeatsUsed(activeUsers) + computeSeatsUsed(outstandingInvites);
}

/**
 * True when `seatsUsed >= maxUsers`. A tenant with `max_users === 0` is
 * always blocked — used by tests to assert the hard-stop branch.
 */
export function isAtOrOverQuota(seatsUsed: number, maxUsers: number): boolean {
    return seatsUsed >= maxUsers;
}
