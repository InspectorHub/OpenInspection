/**
 * A booking-fixture date that cannot rot.
 *
 * Every spec that POSTs `/book` used to name a literal date — `2026-06-08`,
 * chosen because it was a Monday and, at the time, in the future. The second half
 * of that stopped being true, and F42 (the public booking page accepted a Sunday
 * six years past, walked it to the last step, and the server then blamed the
 * TIME) added the rule that makes it matter: a past date is now refused at the
 * request boundary, so a fixture with a literal date eventually tests nothing but
 * the clock.
 *
 * The weekday still has to hold, because these fixtures seed
 * `availability.dayOfWeek` to match — so this returns the NEXT occurrence of the
 * weekday the caller names, far enough out that a tenant lead-time rule cannot
 * interfere either.
 */

/** Days of buffer, so a same-day cutoff or a lead-time rule is never the cause. */
const MIN_DAYS_AHEAD = 14;

/**
 * The next `dayOfWeek` (0 = Sunday … 6 = Saturday) at least two weeks out, as
 * `YYYY-MM-DD`. Built from local parts: the value is a civil date, and the specs
 * compare it against `availability.dayOfWeek`, which the service derives the
 * same way.
 */
export function nextWeekday(dayOfWeek: number, from: Date = new Date()): string {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + MIN_DAYS_AHEAD);
    while (d.getDay() !== dayOfWeek) d.setDate(d.getDate() + 1);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
