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

/**
 * The window to judge a slot over when the caller has not said which time slot the
 * customer will pick: the longest one the booking could take, so a start offered
 * here fits whichever window is chosen later.
 */
export function widestBookingWindowMin(serviceTotalMin: number | null | undefined): number {
    return Math.max(bookingWindowMin(serviceTotalMin, 'all-day'), bookingWindowMin(serviceTotalMin, 'morning'), bookingWindowMin(serviceTotalMin, 'custom'));
}

/**
 * Whether a slot on the grid falls inside a requested booking window.
 *
 * Morning is before noon, afternoon is noon onward, all day is flexible timing.
 * Slot times are zero-padded `HH:MM`, so a string compare is a clock compare.
 * `custom` stays EXACT: a caller naming a time is asking for that time.
 */
export function slotSatisfiesWindow(
    slot: string,
    timeSlot: 'morning' | 'afternoon' | 'all-day' | 'custom',
    customTime: string | null,
): boolean {
    switch (timeSlot) {
        case 'morning':   return slot < '12:00';
        case 'afternoon': return slot >= '12:00';
        case 'all-day':   return true;
        case 'custom':    return slot === customTime;
    }
}

export function bookingWindowMin(serviceTotalMin: number | null | undefined, timeSlot?: string | null): number {
    if (serviceTotalMin && serviceTotalMin > 0) return serviceTotalMin;
    if (timeSlot === 'all-day') return 540;
    if (timeSlot === 'morning' || timeSlot === 'afternoon') return 240;
    return DEFAULT_BOOKING_WINDOW_MIN;
}
