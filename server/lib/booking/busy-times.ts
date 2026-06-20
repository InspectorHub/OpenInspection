/**
 * Booking busy-time computation.
 *
 * Extracted from server/services/booking.service.ts (pure movement): both the
 * legacy per-inspector getAvailableSlots and the tenant-aggregation
 * getTenantSlots derive the set of busy HH:MM times from existing inspection
 * rows by reading positions 11–16 of the ISO datetime. This is that derivation.
 */

/** A row carrying an inspection `date` (ISO datetime string or Date). */
export interface BusyRow {
    date: unknown;
}

/**
 * Returns the set of busy slot times (HH:MM) from the given rows, reading
 * `String(row.date).slice(11, 16)` — the HH:MM portion of the ISO datetime.
 */
export function computeBusyTimes(rows: BusyRow[]): Set<string> {
    return new Set(rows.map(r => String(r.date).slice(11, 16)));
}
