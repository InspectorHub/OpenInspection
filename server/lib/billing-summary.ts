/**
 * Design System 0520 subsystem C P9 T9.1 — billing summary aggregator.
 *
 * Pure helper used by both `GET /api/billing/summary` (this repo) and
 * the SettingsTeam page's "billing pointer" card (Phase 10). Splits the
 * (permanent / guest) breakdown so the UI can show them side-by-side
 * without an extra round trip.
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
    nowSeconds: number,
): BillingSummary {
    const seatsUsed = computeSeatsUsed(users, nowSeconds);
    const guests    = users.filter(u =>
        u.expiresAt != null && u.expiresAt > nowSeconds,
    ).length;
    const permanent = seatsUsed - guests;

    return {
        tier:      tenant.tier      ?? DEFAULT_TIER,
        maxUsers:  tenant.maxUsers  ?? DEFAULT_MAX_USERS,
        seatsUsed,
        permanent,
        guests,
    };
}
