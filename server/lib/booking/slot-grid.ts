/**
 * Booking slot-grid generation.
 *
 * Extracted from server/services/booking.service.ts (pure movement): both the
 * legacy per-inspector getAvailableSlots and the tenant-aggregation
 * getTenantSlots build a deduped, in-order slot grid from a set of
 * availability windows with the identical loop body. This is that loop.
 *
 * Modes (tenant_configs.booking_slot_mode):
 * - `fixed` (default): window-aligned — first start is the window startTime,
 *   then step by interval (legacy behavior when interval is 30).
 * - `open`: clock-aligned — first start is the next interval boundary on the
 *   wall clock that falls inside the window, then step by interval.
 */

/** An availability window with optional start/end (defaults 08:00–17:00). */
export interface SlotWindow {
    startTime: string | null;
    endTime: string | null;
}

export type BookingSlotMode = 'open' | 'fixed';
export type BookingSlotIntervalMin = 15 | 30 | 60;

export interface BuildSlotGridOptions {
    /** Default `fixed` — preserves pre-slot-mode window alignment. */
    mode?: BookingSlotMode;
    /** Grid step in minutes. Default 30. */
    intervalMin?: BookingSlotIntervalMin;
}

function parseMinutes(hhmm: string): number {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
}

function formatMinutes(total: number): string {
    const h = Math.floor(total / 60);
    const m = total % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Next clock-aligned boundary at or after `hhmm` for the given interval. */
function ceilToInterval(hhmm: string, intervalMin: number): string {
    const total = parseMinutes(hhmm);
    const rem = total % intervalMin;
    return formatMinutes(rem === 0 ? total : total + (intervalMin - rem));
}

/**
 * Builds a deduped list of slot start times (HH:MM) across the given windows.
 * Order follows first-seen insertion, mirroring the original
 * `if (!slots.includes(current)) slots.push(current)` accumulation.
 */
export function buildSlotGrid(
    windows: SlotWindow[],
    options: BuildSlotGridOptions = {},
): string[] {
    const mode = options.mode ?? 'fixed';
    const intervalMin = options.intervalMin ?? 30;
    const slots: string[] = [];

    for (const w of windows) {
        const start = w.startTime ?? '08:00';
        const end = w.endTime ?? '17:00';
        let current = mode === 'open' ? ceilToInterval(start, intervalMin) : start;
        while (current < end) {
            if (!slots.includes(current)) slots.push(current);
            const next = parseMinutes(current) + intervalMin;
            current = formatMinutes(next);
        }
    }
    return slots;
}
