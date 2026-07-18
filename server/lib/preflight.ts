/**
 * Design System 0520 subsystem E P1.2 — Publish pre-flight aggregator.
 *
 * Pure helper. The service wrapper (inspection.service.ts.compute-
 * Preflight) loads `inspections` + `inspection_results.data`, then
 * delegates here.
 *
 * Gates:
 *   • allRated             — every item in results.data has rating OR value
 *   • propertyFactsComplete — all 5 required keys present in property_facts
 *   • coverPhotoSet        — inspections.cover_photo_id is non-null
 *   • agreementSigned      — inspections.agreement_signed_at is non-null
 */

const REQUIRED_FACT_KEYS = [
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
    notes?:  string;
}

export interface PreflightResult {
    allRated:              boolean;
    unratedCount:          number;
    propertyFactsComplete: boolean;
    missingFacts:          string[];
    coverPhotoSet:         boolean;
    agreementSigned:       boolean;
    noOpenFields:          boolean;
    openFieldCount:        number;
}

export function computePreflightFromData(
    inspection: PreflightInspectionInput,
    items: Record<string, PreflightItem>,
): PreflightResult {
    const entries = Object.values(items);
    const unratedCount = entries.filter(i => i.rating == null && i.value == null).length;
    const allRated = entries.length > 0 && unratedCount === 0;

    const facts: Record<string, unknown> = inspection.propertyFacts ?? {};
    const missingFacts = REQUIRED_FACT_KEYS.filter(k => {
        const v = facts[k];
        return v == null || v === '';
    });

    const FIELD_RE = /\[[A-Z_]+\]/g;
    let openFieldCount = 0;
    for (const item of entries) {
        if (typeof item.notes === 'string') {
            const matches = item.notes.match(FIELD_RE);
            if (matches) openFieldCount += matches.length;
        }
    }

    return {
        allRated,
        unratedCount,
        propertyFactsComplete: missingFacts.length === 0,
        missingFacts,
        coverPhotoSet:         inspection.coverPhotoId != null,
        agreementSigned:       inspection.agreementSignedAt != null,
        noOpenFields:          openFieldCount === 0,
        openFieldCount,
    };
}
