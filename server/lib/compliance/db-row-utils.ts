/**
 * Track I-a GDPR — driver/timestamp helpers shared by the compliance executors.
 *
 * `changeCount` and `toMs` existed as byte-identical private copies in
 * `erasure-orchestrator.ts` and `retention-sweep.ts`. They are one definition
 * now: the two modules must agree on what "this update changed N rows" and
 * "this column is at instant T" mean, because a row erased on a DSAR and later
 * swept past its window has to land in the same place either way.
 *
 * The year arithmetic is deliberately UTC-only. A retention window is a record
 * -keeping obligation measured in whole years, not a local-calendar event, and
 * `setUTCFullYear` is the one operation that cannot shift by a day when the
 * boundary lands on a DST change.
 */

/** Driver-tolerant row-count extraction (D1: meta.changes; better-sqlite3: changes). */
export function changeCount(res: unknown): number {
    const r = res as { meta?: { changes?: number }; changes?: number } | undefined;
    return r?.meta?.changes ?? r?.changes ?? 0;
}

/** Coerce a timestamp column value (Date | number | null) to Unix-MS or null. */
export function toMs(v: unknown): number | null {
    if (v == null) return null;
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'number') return v;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/** Add whole years to a Unix-MS timestamp, returning a Unix-MS integer. */
export function addYearsMs(ms: number, years: number): number {
    const d = new Date(ms);
    d.setUTCFullYear(d.getUTCFullYear() + years);
    return d.getTime();
}

/** Subtract whole years from a Unix-MS timestamp, returning a Unix-MS integer. */
export function subtractYearsMs(ms: number, years: number): number {
    const d = new Date(ms);
    d.setUTCFullYear(d.getUTCFullYear() - years);
    return d.getTime();
}
