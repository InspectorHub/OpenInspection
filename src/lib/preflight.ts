/**
 * Design System 0520 subsystem E P1.2 — Publish pre-flight aggregator.
 *
 * Pure helper. The service wrapper (inspection.service.ts.compute-
 * Preflight) loads `inspections` + `inspection_results.data` + an
 * apprentice pending count, then delegates here.
 *
 * Five gates:
 *   • allRated             — every item in results.data has rating OR value
 *   • apprenticeReviewed   — no pending apprentice_reviews for this inspection
 *   • propertyFactsComplete — all 5 required keys present in property_facts
 *   • coverPhotoSet        — inspections.cover_photo_id is non-null
 *   • agreementSigned      — inspections.agreement_signed_at is non-null
 *
 * Pass `pendingApprenticeCount: undefined` when the apprentice_reviews
 * table does not exist (subsystem C absent) — the gate gracefully
 * no-ops to "reviewed".
 */

export const REQUIRED_FACT_KEYS = [
    'year_built',
    'sqft',
    'foundation',
    'bedrooms',
    'bathrooms',
] as const;

export interface PreflightInspectionInput {
    coverPhotoId:      string | null;
    propertyFacts:     Record<string, unknown> | null;
    agreementSignedAt: number | null;
}

export interface PreflightItem {
    rating?: unknown;
    value?:  unknown;
}

export interface PreflightResult {
    allRated:              boolean;
    unratedCount:          number;
    apprenticeReviewed:    boolean;
    apprenticePending:     number;
    propertyFactsComplete: boolean;
    missingFacts:          string[];
    coverPhotoSet:         boolean;
    agreementSigned:       boolean;
}

export function computePreflightFromData(
    inspection: PreflightInspectionInput,
    items: Record<string, PreflightItem>,
    pendingApprenticeCount: number | undefined,
): PreflightResult {
    const entries = Object.values(items);
    const unratedCount = entries.filter(i => i.rating == null && i.value == null).length;
    const allRated = entries.length > 0 && unratedCount === 0;

    const facts: Record<string, unknown> = inspection.propertyFacts ?? {};
    const missingFacts = REQUIRED_FACT_KEYS.filter(k => {
        const v = facts[k];
        return v == null || v === '';
    });

    // Subsystem C dependency — when the count is undefined the
    // apprentice_reviews table is presumed absent and the gate passes.
    const pending = pendingApprenticeCount ?? 0;
    return {
        allRated,
        unratedCount,
        apprenticeReviewed:    pending === 0,
        apprenticePending:     pending,
        propertyFactsComplete: missingFacts.length === 0,
        missingFacts,
        coverPhotoSet:         inspection.coverPhotoId != null,
        agreementSigned:       inspection.agreementSignedAt != null,
    };
}
