/**
 * Design System 0520 subsystem C phase 5 — unified seat-quota helpers.
 *
 * Per the simplified seat model: permanent members + active guests both
 * count against tenants.max_users. Guests are users with `expires_at`
 * set; when the daily cron sweeps expired rows their seats free up
 * automatically. No per-role billing.
 *
 * These helpers are pure so they can be unit-tested without a DB. The
 * route-mounted middleware lives in `server/features/seat-quota/middleware`
 * — it composes `getSeatUsage` (which now defers to `computeSeatsUsed`)
 * with the profile gate. GuestInviteService.claim also uses these
 * helpers directly to check quota before creating the new user row.
 */

export interface SeatUser {
    id: string;
    expiresAt?: number | null;
}

/**
 * Count seats actively held by `users` at the given timestamp.
 *
 * - Permanent members (`expires_at == null`) always count.
 * - Guests count only while `expires_at > now`. The boundary is strict:
 *   an `expires_at` exactly equal to `now` is treated as expired so the
 *   cron's idempotent sweep does not race with claim checks.
 */
export function computeSeatsUsed(users: SeatUser[], now: number): number {
    return users.filter(u => u.expiresAt == null || u.expiresAt > now).length;
}

/**
 * True when `seatsUsed >= maxUsers`. A tenant with `max_users === 0` is
 * always blocked — used by tests to assert the hard-stop branch.
 */
export function isAtOrOverQuota(seatsUsed: number, maxUsers: number): boolean {
    return seatsUsed >= maxUsers;
}
