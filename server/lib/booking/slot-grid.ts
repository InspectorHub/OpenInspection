/**
 * Booking slot-grid generation.
 *
 * Extracted from server/services/booking.service.ts (pure movement): both the
 * legacy per-inspector getAvailableSlots and the tenant-aggregation
 * getTenantSlots build a deduped, in-order 30-minute slot grid from a set of
 * availability windows with the identical loop body. This is that loop.
 */

/** An availability window with optional start/end (defaults 08:00–17:00). */
export interface SlotWindow {
    startTime: string | null;
    endTime: string | null;
}

/**
 * Builds a deduped list of 30-minute slot start times (HH:MM) across the given
 * windows. Order follows first-seen insertion, mirroring the original
 * `if (!slots.includes(current)) slots.push(current)` accumulation.
 */
export function buildSlotGrid(windows: SlotWindow[]): string[] {
    const slots: string[] = [];
    for (const w of windows) {
        const start = w.startTime ?? '08:00';
        const end   = w.endTime   ?? '17:00';
        let current = start;
        while (current < end) {
            if (!slots.includes(current)) slots.push(current);
            const [h, m] = current.split(':').map(Number);
            const next = new Date(0, 0, 0, h, m + 30);
            current = `${String(next.getHours()).padStart(2, '0')}:${String(next.getMinutes()).padStart(2, '0')}`;
        }
    }
    return slots;
}
