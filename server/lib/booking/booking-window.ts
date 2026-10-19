/**
 * How long a booking made through the public page occupies the inspector.
 *
 * ONE rule, used by the slot grid (what is offered), by admission (what is
 * accepted) and by the insert (what is stored as duration_min), so the three can
 * never disagree about whether a slot fits. It is the booked services' total
 * minutes when they carry durations, otherwise the window the customer picked:
 * 540 for all-day, 240 for morning or afternoon, 180 for anything else (including
 * a page that has not chosen a window yet).
 */
const DEFAULT_BOOKING_WINDOW_MIN = 180;

export function bookingWindowMin(serviceTotalMin: number | null | undefined, timeSlot?: string | null): number {
    if (serviceTotalMin && serviceTotalMin > 0) return serviceTotalMin;
    if (timeSlot === 'all-day') return 540;
    if (timeSlot === 'morning' || timeSlot === 'afternoon') return 240;
    return DEFAULT_BOOKING_WINDOW_MIN;
}
