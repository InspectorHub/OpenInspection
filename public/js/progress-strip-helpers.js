// Design System 0520 subsystem B phase 6 task 6.1 — ProgressStrip helpers.
//
// Pure-function computations consumed by:
//   1. /js/progress-strip.js (Alpine factory).
//   2. tests/unit/progress-strip-helpers.spec.ts (vitest).
//
// No DOM dependency — keep this file mockable for both the donut SVG
// + ETA pill + section heat-map row.

/**
 * Aggregate { rated, total, percent } over an items array.
 *   - "rated" = item.rating is non-null AND non-undefined
 *   - "percent" rounds half-up; empty input yields 0 across the board
 *
 * Consumed by both the donut SVG (stroke-dasharray) and the "12 of 47"
 * footer pill in components/progress-strip.tsx.
 */
export function computeCompletion(items) {
    const total = items.length;
    if (total === 0) return { rated: 0, total: 0, percent: 0 };
    const rated = items.filter(i => i?.rating != null).length;
    return { rated, total, percent: Math.round((rated / total) * 100) };
}

/**
 * Split items into the five rating buckets the design's ProgressStrip
 * surfaces as tally chips at the top of the inspection editor:
 *   def      — Defect (rating === 'DEF' / 'Defect' / similar)
 *   mon      — Monitor
 *   sat      — Satisfactory
 *   ni       — Not Inspected
 *   np       — Not Present
 *   unrated  — rating == null
 *
 * Rating strings are matched case-insensitively against their canonical
 * three-letter abbreviation OR full word. Anything else (e.g. custom
 * tenant ratings) buckets into `other` so the chips still sum cleanly.
 */
export function tallyByRating(items) {
    const out = { def: 0, mon: 0, sat: 0, ni: 0, np: 0, other: 0, unrated: 0 };
    for (const it of items) {
        const r = it?.rating;
        if (r == null) { out.unrated++; continue; }
        const code = String(r).toUpperCase();
        if      (code === 'DEF' || code === 'DEFECT' || code === 'D')      out.def++;
        else if (code === 'MON' || code === 'MONITOR' || code === 'M')     out.mon++;
        else if (code === 'SAT' || code === 'SATISFACTORY' || code === 'S') out.sat++;
        else if (code === 'NI'  || code === 'N/I' || code === 'NOT INSPECTED') out.ni++;
        else if (code === 'NP'  || code === 'N/P' || code === 'NOT PRESENT')   out.np++;
        else out.other++;
    }
    return out;
}

/**
 * Project remaining minutes from a rolling window of per-item durations
 * (seconds) and the unrated-item count. Returns 0 when either input is
 * empty so the UI can hide the pill cleanly.
 */
export function etaMinutes(durationsSec, remaining) {
    if (!Array.isArray(durationsSec) || durationsSec.length === 0) return 0;
    if (!remaining || remaining <= 0) return 0;
    const avg = durationsSec.reduce((a, b) => a + b, 0) / durationsSec.length;
    return Math.round((avg * remaining) / 60);
}

/**
 * Per-section completion rollup. Preserves first-seen section iteration
 * order so the heat-map row renders sections in the same order the
 * editor's section rail does (template-defined).
 */
export function sectionHeatMap(items) {
    const order = [];
    const acc   = new Map();
    for (const i of items) {
        const k = i.sectionId;
        if (!acc.has(k)) {
            order.push(k);
            acc.set(k, { sectionId: k, rated: 0, total: 0 });
        }
        const e = acc.get(k);
        e.total++;
        if (i.rating != null) e.rated++;
    }
    return order.map(k => {
        const e = acc.get(k);
        const percent = e.total === 0 ? 0 : Math.round((e.rated / e.total) * 100);
        return { sectionId: e.sectionId, rated: e.rated, total: e.total, percent };
    });
}
