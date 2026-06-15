/**
 * Iter-2 UX bug #5 — Calendar visual differentiation for inspection events.
 *
 * Pure helper that maps an inspection's lifecycle status to FullCalendar
 * style hints. Drafts get a lighter color and an explicit "DRAFT" prefix in
 * the title so inspectors can spot un-confirmed work straight from the grid
 * without clicking through.
 *
 * Cancelled events get a strikethrough-style gray pill so they stay visible
 * but read as "not happening". Everything else stays on the default indigo
 * brand color — same as before this change so existing UX is preserved.
 *
 * Pure function: easy to unit-test with a status matrix and reuse anywhere
 * we render an inspection on a calendar surface.
 */

import { INSPECTION_STATUS } from './status/inspection-status';

export interface CalendarEventStyle {
    /** Hex fill color FullCalendar applies to the event chip. */
    color: string;
    /** Optional title prefix (e.g. "DRAFT · ") — empty string when not needed. */
    titlePrefix: string;
    /**
     * If true the event chip should render with an "outline" treatment —
     * lighter background, dashed-style border in the front-end CSS. Used
     * for drafts so they read as scheduled-but-tentative.
     */
    isDraft: boolean;
}

/**
 * Computes the visual style for an inspection on the calendar.
 *
 * Defensive: an unknown / missing status falls through to the default
 * "scheduled" treatment so partial rows never break the calendar render.
 */
export function getCalendarEventStyle(status: string | null | undefined): CalendarEventStyle {
    const s = (status ?? '').toLowerCase();
    if (s === INSPECTION_STATUS.REQUESTED) {
        return {
            // Sprint 1 design tokens — slate-400 reads as "tentative" against
            // the indigo "confirmed" chips without introducing a new hue.
            color: '#94A3B8',
            titlePrefix: 'DRAFT · ',
            isDraft: true,
        };
    }
    if (s === 'cancelled') {
        return {
            color: '#9CA3AF',
            titlePrefix: 'CANCELLED · ',
            isDraft: false,
        };
    }
    return {
        color: '#6366F1', // brand indigo — unchanged from pre-bug #5
        titlePrefix: '',
        isDraft: false,
    };
}
