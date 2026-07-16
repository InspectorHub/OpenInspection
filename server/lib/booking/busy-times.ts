/**
 * Booking busy-time computation.
 *
 * Extracted from server/services/booking.service.ts (pure movement): both the
 * legacy per-inspector getAvailableSlots and the tenant-aggregation
 * getTenantSlots derive the set of busy HH:MM times from existing inspection
 * rows by reading positions 11–16 of the ISO datetime. This is that derivation.
 *
 * Calendar blocks (time off) also contribute: all-day blocks remove the
 * inspector entirely for that date; timed blocks mark overlapping slot
 * starts busy (half-open [start, end) vs slot [start, start+interval)).
 */

/** A row carrying an inspection `date` (ISO datetime string or Date). */
export interface BusyRow {
    date: unknown;
}

/** A calendar_blocks row used for slot subtraction. */
export interface CalendarBlockBusy {
    allDay: boolean;
    startTime: string | null;
    endTime: string | null;
}

/**
 * Returns the set of busy slot times (HH:MM) from the given rows, reading
 * `String(row.date).slice(11, 16)` — the HH:MM portion of the ISO datetime.
 */
export function computeBusyTimes(rows: BusyRow[]): Set<string> {
    return new Set(rows.map(r => String(r.date).slice(11, 16)));
}

function parseMinutes(hhmm: string): number {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
}

/**
 * True when any block is all-day — inspector contributes no slots that day
 * (same as a blocking availability override with no additive windows).
 */
export function hasAllDayCalendarBlock(blocks: CalendarBlockBusy[]): boolean {
    return blocks.some((b) => b.allDay);
}

/**
 * Adds HH:MM slot starts that overlap any timed calendar block into `busy`.
 * Slots overlap a block when [slotStart, slotStart+interval) intersects
 * [blockStart, blockEnd).
 */
export function addCalendarBlockBusyTimes(
    busy: Set<string>,
    blocks: CalendarBlockBusy[],
    candidateSlots: string[],
    intervalMin: number,
): void {
    const timed = blocks.filter((b) => !b.allDay && b.startTime && b.endTime);
    if (timed.length === 0) return;

    for (const slot of candidateSlots) {
        if (busy.has(slot)) continue;
        const slotStart = parseMinutes(slot);
        const slotEnd = slotStart + intervalMin;
        for (const b of timed) {
            const blockStart = parseMinutes(b.startTime!);
            const blockEnd = parseMinutes(b.endTime!);
            if (slotStart < blockEnd && slotEnd > blockStart) {
                busy.add(slot);
                break;
            }
        }
    }
}
