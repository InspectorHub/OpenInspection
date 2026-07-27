/**
 * How long a delivered report link stays usable (IA-36 ⑤⑥⑦).
 *
 * One definition, read by every side that has to agree: the settings screen
 * that sets it, the token service that stamps `expires_at` when a link is
 * minted, and the People card that reports the resulting date to the inspector.
 *
 * The policy is a DURATION, never an absolute date. Only an absolute date can
 * be put in the past, so "expires before it is sent" is impossible by
 * construction — no min-validation, no error copy, no footnote telling the user
 * to revoke instead. Wanting a link dead NOW is a different verb (Reset /
 * Remove), not an expiry of zero.
 *
 * Default is `never`: the shipped behaviour was an open-ended link, and
 * customers of migrated companies keep report links for years. A company opts
 * into expiry; nobody is opted in silently. Applying a policy to links ALREADY
 * issued is likewise never automatic — see PortalAccessService, which reads the
 * policy only on the mint/rotate path.
 */
export type ReportLinkTtlUnit = 'days' | 'months' | 'years';

export interface ReportLinkTtlDuration {
    count: number;
    unit: ReportLinkTtlUnit;
}

export type ReportLinkTtl = 'never' | ReportLinkTtlDuration;

/**
 * Offered in the picker. 2 years is the only figure with published vendor
 * precedent (ISN's documented default); 90 days and 12 months bracket it.
 */
export const REPORT_LINK_TTL_PRESETS: readonly ReportLinkTtlDuration[] = [
    { count: 90, unit: 'days' },
    { count: 12, unit: 'months' },
    { count: 2, unit: 'years' },
];

const UNITS: readonly ReportLinkTtlUnit[] = ['days', 'months', 'years'];

/** Upper bound on the picker's number field — keeps a typo'd 99999 out of the DB. */
export const REPORT_LINK_TTL_MAX_COUNT = 999;

interface PrefsLike {
    reportLinkTtl?: unknown;
}

/**
 * Read the policy out of the `inspection_prefs` JSON blob. Anything that is not
 * a well-formed duration reads as `never` — a corrupted policy must not silently
 * shorten links that are already in customers' inboxes.
 */
export function resolveReportLinkTtl(prefs: PrefsLike | null | undefined): ReportLinkTtl {
    const raw = prefs?.reportLinkTtl;
    if (raw === 'never' || raw == null) return 'never';
    if (typeof raw !== 'object') return 'never';
    const { count, unit } = raw as Partial<ReportLinkTtlDuration>;
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > REPORT_LINK_TTL_MAX_COUNT) return 'never';
    if (typeof unit !== 'string' || !UNITS.includes(unit as ReportLinkTtlUnit)) return 'never';
    return { count, unit: unit as ReportLinkTtlUnit };
}

/**
 * Add `months` calendar months to an epoch-ms instant, clamping to the last day
 * of the target month (Jan 31 + 1 month = Feb 28, not Mar 3). Pure UTC —
 * `expires_at` is an instant, not a civil date, so no timezone enters here.
 */
function addMonths(from: number, months: number): number {
    const d = new Date(from);
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + months);
    const lastDayOfTarget = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, lastDayOfTarget));
    return d.getTime();
}

/**
 * The absolute instant a link minted at `from` should stop working, or null for
 * `never` (the `expires_at` column stays NULL — an open link, not a far-future
 * one, so the guard's "no expiry" branch stays honest).
 */
export function reportLinkExpiresAt(ttl: ReportLinkTtl, from: number): number | null {
    if (ttl === 'never') return null;
    switch (ttl.unit) {
        case 'days':   return from + ttl.count * 86_400_000;
        case 'months': return addMonths(from, ttl.count);
        case 'years':  return addMonths(from, ttl.count * 12);
    }
}
