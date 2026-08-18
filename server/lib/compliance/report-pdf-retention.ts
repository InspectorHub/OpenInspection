/**
 * How long a rendered report PDF is kept.
 *
 * A platform DEFAULT, not a legal requirement, and the difference is the whole
 * point of this file existing rather than a bare constant.
 *
 * ── What review struck, and why it matters here ────────────────────────────
 * This repository used to derive seven years as "5 + 2": Illinois requires five
 * years for home-inspection contracts, reports and supporting data, plus two
 * years past final disposition of a qualifying judicial proceeding. Put to
 * review, that derivation was REJECTED (review, decision). Illinois is
 * five years OR two years past final disposition, WHICHEVER IS LONGER — the
 * second figure is an event-dependent tail, not a fixed cap, and a proceeding
 * ending in year six extends the statutory period past seven. So seven years
 * cannot be presented as the longest statutory period, and a register row
 * reading `P7Y — legal basis = Illinois law` invites the next reader to
 * conclude that a California tenant is legally required to keep seven years.
 *
 * The number survived. The reasoning did not, and the reasoning is what the
 * settings screen shows a customer.
 *
 * ── Zero means indefinite ───────────────────────────────────────────────────
 * That is a controller instruction under review round-14 framing, which the
 * platform executes. It is not the default and it is not us declining to have
 * one. The dominant competitor stores reports indefinitely including after
 * cancellation, so our having a default at all runs against what an inspection
 * company expects — which is exactly why it is disclosed at the point of
 * setting rather than on a policy page.
 *
 * ── What this module does NOT decide ────────────────────────────────────────
 * Tenant override is not absolute (24a-2): the effective period is
 * `jurisdictional minimum + tenant instruction + platform constraints`, never
 * `tenant choice > law`. This function answers only the middle term — what the
 * tenant asked for, or the default when they have not asked. A jurisdictional
 * floor, once we can determine one per tenant, is applied above this and not
 * folded into it; folding it in here would make one function silently
 * responsible for a legal determination it has no facts for.
 */

export const REPORT_PDF_RETENTION_DEFAULT_YEARS = 7;

/** One jurisdiction fact, with the date it was checked. */
export interface RetentionJurisdictionFact {
    jurisdiction: string;
    citation: string;
    /**
     * YYYY-MM-DD. Required, and required for a reason: Washington completed a
     * home-inspector rules revision in July 2026, and a citation with no as-of
     * date cannot be known to be stale (review, second constraint).
     */
    checkedOn: string;
}

/**
 * The basis, in a shape something other than a human can read.
 *
 * The taxonomy is the part that keeps the distinction from resting on whether
 * anybody reads the prose beside it.
 */
export const REPORT_PDF_RETENTION_BASIS = {
    primaryReason: 'legal_claim_defence',
    secondaryReason: 'regulatory_record_retention',
    authorityType: 'risk_based_platform_default',
    statutoryRequirement: false,

    /**
     * review replacement wording, VERBATIM. Not to be paraphrased — the
     * clauses a paraphrase loses first are the two that do the work, and both
     * are asserted in `report-pdf-retention.spec.ts`.
     */
    disclosure:
        'Platform default: P7Y. '
        + 'This is a platform-selected default for tenant-silent cases, not a statutory retention period '
        + 'and not a representation that seven years is the maximum legally required period. '
        + 'The default is informed primarily by legal-claim defence and secondarily by regulatory '
        + 'record-retention requirements. Illinois requires five years for home-inspection contracts, '
        + 'reports and supporting data, with a longer period where a qualifying judicial proceeding '
        + 'extends two years beyond final disposition. Virginia and Washington identify three-year '
        + 'retention periods for specified home-inspection records. '
        + 'P7Y therefore provides a fixed operational claim-defence buffer while avoiding indefinite '
        + 'platform retention. Tenant-selected retention remains controlling where legally permissible.',

    jurisdictionFacts: [
        { jurisdiction: 'US-IL', citation: 'Home-inspection contracts, reports and supporting data: five years, or two years past final disposition of a qualifying judicial proceeding, whichever is longer.', checkedOn: '2026-08-16' },
        { jurisdiction: 'US-VA', citation: 'Three-year retention period identified for specified home-inspection records.', checkedOn: '2026-08-16' },
        { jurisdiction: 'US-WA', citation: 'Three-year retention period identified for specified home-inspection records. Rules revision completed July 2026 — re-check before relying on this.', checkedOn: '2026-08-16' },
    ] as RetentionJurisdictionFact[],
} as const;

/**
 * The tenant's chosen window, or the disclosed default.
 *
 * Anything that is not a whole non-negative number falls back. A NULL column on
 * an old row, or a string that survived a JSON round trip, must never become a
 * retention window: the sweep would compute a cutoff from NaN and then delete
 * everything or nothing, and neither failure announces itself.
 */
export function resolveReportPdfRetentionYears(
    cfg: { reportPdfRetentionYears?: number | null } | null | undefined,
): number {
    const v = cfg?.reportPdfRetentionYears;
    return typeof v === 'number' && Number.isInteger(v) && v >= 0
        ? v
        : REPORT_PDF_RETENTION_DEFAULT_YEARS;
}
