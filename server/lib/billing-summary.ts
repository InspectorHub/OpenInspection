/**
 * Billing summary aggregator.
 *
 * Pure helper used by both `GET /api/billing/summary` (this repo) and
 * the SettingsTeam page's "billing pointer" card. Every member counts as
 * one seat; the `permanent` / `guests` fields are retained for response
 * shape stability (guests are always 0 since the guest subsystem was
 * removed — `expires_at` is DEAD).
 */
import { computeSeatsUsed, type SeatUser } from './middleware/seat-guard';

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
    users: SeatUser[],
    tenant: TenantBillingFields,
): BillingSummary {
    const seatsUsed = computeSeatsUsed(users);

    return {
        tier:      tenant.tier      ?? DEFAULT_TIER,
        maxUsers:  tenant.maxUsers  ?? DEFAULT_MAX_USERS,
        seatsUsed,
        permanent: seatsUsed,
        guests:    0,
    };
}
