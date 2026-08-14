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
 * Default is TWO YEARS.
 *
 * It was `never` until 2026-08-14, because the shipped behaviour was an
 * open-ended link and migrated companies' customers had been holding those
 * links for years. That reasoning covers companies which predate the setting;
 * for one created afterwards, "keeps what it had" describes nothing, and an
 * open-ended link to a homebuyer's report was our decision on their behalf.
 *
 * Two years is not a figure we invented — it is the one preset below with
 * published vendor precedent, and it now applies to every company rather than
 * splitting the default by signup date.
 *
 * This is far less disruptive than it sounds, and the reason is structural:
 * the policy is read only on the mint/rotate path (see PortalAccessService),
 * so links ALREADY in customers' inboxes keep the `expires_at` they were
 * stamped with. Changing the default changes what the NEXT link gets. A
 * company that wants open-ended links selects `never` and knows it did.
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
 * The unset default. Two years — see the header for why this figure.
 *
 * NOT exported, and the spec that pins it does not import it: a test asserting
 * `resolveReportLinkTtl(null) === REPORT_LINK_TTL_DEFAULT` would pass whatever
 * the constant said, which is the one thing the test exists to catch. It spells
 * out `{ count: 2, unit: 'years' }` instead, so changing this line turns a spec
 * red — which is what makes the default a decision rather than a detail.
 */
const REPORT_LINK_TTL_DEFAULT: ReportLinkTtlDuration = { count: 2, unit: 'years' };

/**
 * Read the policy out of the `inspection_prefs` JSON blob.
 *
 * Two different absences, two different answers, and the difference is the
 * whole point:
 *
 *   - **Nothing stored** → the default. The company has not chosen, so the
 *     platform default applies.
 *   - **Stored but malformed** → `never`, NOT the default. A corrupted policy
 *     must not silently shorten links already in customers' inboxes, and that
 *     argument survives the default changing: it is about not acting on a value
 *     we cannot read, which is a different question from what to do when there
 *     is no value at all.
 *
 * An explicit `'never'` is a choice and is honoured as one.
 */
export function resolveReportLinkTtl(prefs: PrefsLike | null | undefined): ReportLinkTtl {
    const raw = prefs?.reportLinkTtl;
    if (raw == null) return REPORT_LINK_TTL_DEFAULT;
    if (raw === 'never') return 'never';
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
