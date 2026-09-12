/**
 * What counts as a bookable date, and how it is said out loud.
 *
 * F42 — the public booking page's date field was a bare `<input type="date">`
 * with no `min`, no `max`, no step and no list. Measured: `2020-01-05` (a Sunday,
 * six years in the past) passed client validation silently, did not disable
 * Continue, reached the confirm step, and was rendered back to the visitor as
 * `2020-01-05` before the server refused it — with "That time slot is no longer
 * available. Please pick another time.", which is wrong three ways: the date was
 * never available rather than no longer, the problem is the DATE and not the
 * TIME, and the visitor is left on the last step with no field named.
 *
 * So the rule is decided here rather than left to the widget:
 *
 *   1. NEVER THE PAST. An inspection is a visit someone makes; a date that has
 *      gone is not a preference, it is an impossible request. Enforced again on
 *      the server (`server/services/booking/booking-admission.ts`), in the
 *      TENANT's zone, because a client's clock is not evidence.
 *   2. A HORIZON. A year ahead is generous for a home inspection and still
 *      catches the typo class — `2026` mistyped as `2062` — that no availability
 *      lookup would ever call an error.
 *   3. WORKING DAYS COME FROM THE COMPANY, NOT FROM THIS FILE. Which days are
 *      bookable is already answered by `GET /api/public/slots`, which folds in
 *      weekly hours, slot rules, time off, holidays and calendar blocks. The
 *      step asks it and reports the answer; nothing here guesses at a weekend.
 *
 * Pure, and no `Intl` in the rules themselves, so every branch is testable
 * without a DOM or a locale.
 */

/** How far ahead the picker will accept a date. */
export const BOOKING_HORIZON_DAYS = 365;

/** Why a date cannot be submitted. `null` means it can. */
export type BookingDateIssue = "invalid" | "past" | "too-far";

const CIVIL = /^\d{4}-\d{2}-\d{2}$/;

function pad(n: number): string {
    return String(n).padStart(2, "0");
}

/**
 * Today as the VISITOR's calendar shows it, `YYYY-MM-DD`.
 *
 * Local parts, not `toISOString()`: a visitor in UTC+13 would otherwise be told
 * their own today is in the past, which is the same off-by-one the calendar
 * surface was fixed for. This is the browser's day on purpose — it is what the
 * native picker compares `min` against — and it is only ever a courtesy; the
 * server re-decides in the company's zone.
 */
export function todayCivil(now: Date = new Date()): string {
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** A civil date `days` after `from` (`YYYY-MM-DD` in, same out). */
export function addDaysCivil(from: string, days: number): string {
    if (!CIVIL.test(from)) return from;
    const [y, m, d] = from.split("-").map(Number);
    const shifted = new Date(Date.UTC(y, m - 1, d + days));
    return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/**
 * Whether this date may be submitted at all.
 *
 * An EMPTY value is not an issue here — it is an unanswered question, and the
 * step already holds Continue for that. Reporting it as an error would put a red
 * message under a field the visitor has not reached yet.
 */
export function validateBookingDate(
    date: string,
    opts?: { today?: string; horizonDays?: number },
): BookingDateIssue | null {
    if (!date) return null;
    if (!CIVIL.test(date)) return "invalid";
    const today = opts?.today ?? todayCivil();
    // Civil dates in `YYYY-MM-DD` compare correctly as strings, which is why
    // they are stored that way — no Date, no zone, no DST.
    if (date < today) return "past";
    const last = addDaysCivil(today, opts?.horizonDays ?? BOOKING_HORIZON_DAYS);
    if (date > last) return "too-far";
    return null;
}

/**
 * The date as a person reads it, weekday first.
 *
 * F44 — the confirm step printed the raw `2020-01-05`. A bare ISO string is the
 * one rendering in which a Sunday six years ago looks exactly like next
 * Wednesday; with the weekday on it, the mistake announces itself before the
 * visitor submits. Formatted in UTC against a UTC-anchored civil date so the
 * displayed day cannot shift by one for a viewer east or west.
 */
export function formatBookingDate(date: string, locale: string): string {
    if (!CIVIL.test(date)) return date;
    const [y, m, d] = date.split("-").map(Number);
    return new Intl.DateTimeFormat(locale || "en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "UTC",
    }).format(new Date(Date.UTC(y, m - 1, d)));
}
