/**
 * Bar geometry for the /metrics month charts.
 *
 * ⚠️ WHY THIS IS ARITHMETIC AND NOT A CSS PERCENTAGE. Both month charts used to
 * size their bars with `style={{ height: "<pct>%" }}`, and the bars measured
 * 967 × 0 in a real browser: the percentage hung on a column that is a flex ITEM
 * of an `items-end` row, so its own height is content-derived and therefore
 * INDEFINITE. A percentage height against an indefinite containing block does
 * not resolve — it falls back to `auto`, and an empty `<div>` with `height:auto`
 * is zero pixels tall. The chart rendered its numbers and its month labels and
 * nothing in between, with no `<svg>` and no `<canvas>` to fall back to.
 *
 * Resolving the scale HERE, in pixels, removes the dependency on an ancestor's
 * height entirely: the bar no longer asks its parent anything. That is a
 * stronger fix than giving the parent a definite height, because the next person
 * to restructure the column cannot silently flatten the bars again.
 *
 * It is also the only version that is testable off a real browser. happy-dom and
 * jsdom do no layout, so `getBoundingClientRect()` is zero for every element and
 * a percentage is unfalsifiable there; a px value is the same number the browser
 * would use, and a test can read it.
 */

/** Height of the bar TRACK, in px. Mirrors the `h-40` (10rem) row in metrics.tsx. */
export const BAR_TRACK_PX = 160;

/**
 * Px reserved inside the track for the two labels stacked with the bar (the
 * value above it, the month below it) plus the column's two `gap-1` rows. At
 * 10px type that is ~13px a line; 40 leaves the tallest bar clear of both.
 */
export const BAR_LABELS_PX = 40;

/** Tallest a bar may draw. The month with the largest value gets exactly this. */
export const BAR_MAX_PX = BAR_TRACK_PX - BAR_LABELS_PX;

/**
 * Shortest a bar may draw. A month that is in range but small still has to be
 * visible as a bar — this is the same 4-unit floor the percentage version used,
 * now in the unit that reaches the screen.
 */
export const BAR_MIN_PX = 4;

/**
 * Height in px for a bar worth `value` on a chart whose tallest month is `max`.
 *
 * `max` is the series maximum and is always at least 1 at the call site, but a
 * non-finite or non-positive `max` is still handled rather than trusted — a
 * division that returns `NaN` would reach `style.height` as the string
 * `"NaNpx"`, which is exactly the silent blank this module exists to prevent.
 */
export function barHeightPx(value: number, max: number): number {
    if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return BAR_MIN_PX;
    const scaled = Math.round((Math.max(value, 0) / max) * BAR_MAX_PX);
    return Math.min(Math.max(scaled, BAR_MIN_PX), BAR_MAX_PX);
}

/**
 * The label under a bar, for a `YYYY-MM` month key.
 *
 * Measured on `/metrics`: both charts rendered `month.slice(5)`, so a reader saw
 * `09` under the bar — a number that is not a month name in any locale, and that
 * gives no year at all on a range which crosses one. January carries the year for
 * exactly that reason: it is the only column where the series changed years, so
 * it is the only one where the year tells the reader something.
 *
 * A key that is not `YYYY-MM` is returned unchanged rather than formatted into a
 * confident wrong month — `new Date(NaN)` formats as `Invalid Date`, which would
 * reach the axis as a label.
 */
export function monthLabel(month: string, locale: string): string {
    const match = /^(\d{4})-(\d{2})$/.exec(month);
    if (!match) return month;
    const year = Number(match[1]);
    const monthIndex = Number(match[2]) - 1;
    if (monthIndex < 0 || monthIndex > 11) return month;
    const at = new Date(Date.UTC(year, monthIndex, 1));
    const parts: Intl.DateTimeFormatOptions = monthIndex === 0
        ? { month: "short", year: "numeric", timeZone: "UTC" }
        : { month: "short", timeZone: "UTC" };
    try {
        return new Intl.DateTimeFormat(locale, parts).format(at);
    } catch {
        // An unusable locale tag must not blank the axis.
        return new Intl.DateTimeFormat("en", parts).format(at);
    }
}
