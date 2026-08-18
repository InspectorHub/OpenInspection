/**
 * Billing summary aggregator.
 *
 * Pure helper used by both `GET /api/billing/summary` (this repo) and
 * the SettingsTeam page's "billing pointer" card. Every member counts as
 * one seat; the `permanent` / `guests` fields are retained for response
 * shape stability (guests are always 0 since the guest subsystem was
 * removed — `expires_at` is DEAD).
 *
 * ⚠️ IT TAKES A COUNT, NOT A ROW LIST, AND THAT IS THE POINT. It used to take
 * the rows and count them, which meant the CALLER owned the definition of
 * "a member" — and the route's own query had no `deleted_at IS NULL`, so the
 * billing page charged for people `getSeatUsage` had already released. The
 * count now has exactly one producer (`getSeatUsage`), so the seat guard, the
 * session context, the portal quota sync and this page cannot disagree.
 */

export interface TenantBillingFields {
    maxUsers?: number | null;
    tier?:     string | null;
}

export interface BillingSummary {
    tier:      string;
    maxUsers:  number;
    seatsUsed: number;
    permanent: number;
    guests:    number;
}

const DEFAULT_TIER = 'free';
const DEFAULT_MAX_USERS = 1;

export function summariseSeats(
    seatsUsed: number,
    tenant: TenantBillingFields,
): BillingSummary {
    return {
        tier:      tenant.tier      ?? DEFAULT_TIER,
        maxUsers:  tenant.maxUsers  ?? DEFAULT_MAX_USERS,
        seatsUsed,
        permanent: seatsUsed,
        guests:    0,
    };
}
