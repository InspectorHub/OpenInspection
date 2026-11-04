/**
 * What a published report FREEZES, and how a reader gets it back.
 *
 * A client reads the report as it was when the inspector published it, however the inspector's working
 * copy has moved since. `report_versions.snapshot_json` holds that moment; `getReportData` builds the
 * report from live rows and then overlays the snapshot with the helpers below whenever a version is
 * pinned. Each helper takes the live value and the snapshot and returns the value the report must use:
 * the snapshot's when it carries one, the live one otherwise (a snapshot written before a field was
 * added to it, or a pin that could not be loaded).
 *
 * Kept out of the report service because that file is long and this is a rule rather than a step of
 * building the report: one place that says which parts of the report are frozen.
 */
import type { Snapshot } from './version-diff';

/**
 * The inspection columns that are report CONTENT: what the inspection says about the property and how the
 * report is shaped. Everything else on the row is the order's current state (status, payment, gate, people,
 * timestamps), which a client's copy of the report does not freeze: `reportStatus` in particular has to stay
 * live, because the access gate reads it.
 *
 * Timestamps are deliberately absent. A snapshot is JSON, so a date column comes back as text, and none of
 * these is read as a date.
 */
const FROZEN_INSPECTION_FIELDS = [
    'propertyAddress', 'addressStreet', 'addressCity', 'addressState', 'addressZip', 'addressCounty', 'county', 'unit',
    'date', 'closingDate',
    'yearBuilt', 'sqft', 'foundationType', 'bedrooms', 'bathrooms', 'lotSize', 'propertyFacts',
    'coverPhotoId', 'coverCrop', 'coverImageKey',
    'propertyType', 'commercialSubtype', 'reportTier', 'unitInspectionMode',
    'templateSnapshot', 'templateSnapshotVersion',
    'pcaNarrative', 'deviations', 'samplingDeclaration',
    'reportPhotoMode', 'reportPhotoColumns', 'profileOverride', 'badgeLayoutOverride',
] as const;

/** The inspection row with its content columns taken from the snapshot; the order's current state stays live. */
export function freezeInspection<T extends object>(live: T, pinned: Snapshot | null): T {
    const frozen = pinned?.inspection;
    if (!frozen) return live;
    const patch: Record<string, unknown> = {};
    for (const key of FROZEN_INSPECTION_FIELDS) {
        if (key in frozen) patch[key] = frozen[key];
    }
    return Object.assign({}, live, patch);
}

/** The results row with its findings (and the rating system they were rated on) taken from the snapshot. */
export function freezeResultsRow<R extends object>(live: R | undefined, pinned: Snapshot | null): R | undefined {
    if (!pinned || typeof pinned.data !== 'object' || pinned.data === null) return live;
    const patch: Record<string, unknown> = { data: pinned.data };
    if ('ratingSystemSnapshot' in pinned) patch.ratingSystemSnapshot = pinned.ratingSystemSnapshot ?? null;
    return Object.assign({}, live ?? {}, patch) as R;
}

/** The unit tree as published, in the order the report lists it. */
export function freezeUnitRows<U extends { sortOrder?: number | null }>(live: U[], pinned: Snapshot | null): U[] {
    if (!pinned || !Array.isArray(pinned.units)) return live;
    return [...(pinned.units as unknown as U[])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

/** The cost line items the cost tables were built from, or null when the snapshot does not carry them. */
export function frozenCostItems<I>(pinned: Snapshot | null): I[] | null {
    return Array.isArray(pinned?.costItems) ? pinned.costItems as unknown as I[] : null;
}

/** The calendar year the reserve schedule counts from: the year the version was published in, when the snapshot says. */
export function frozenCostYear(pinned: Snapshot | null, fallback: number): number {
    return typeof pinned?.costYear === 'number' ? pinned.costYear : fallback;
}

/** Columns the compliance tables store as timestamps; a snapshot holds them as text and the report reads them as dates. */
const COMPLIANCE_DATE_FIELDS = ['signedAt', 'sentAt', 'receivedAt', 'updatedAt', 'createdAt'] as const;

function reviveDates<T extends Record<string, unknown>>(row: T): T {
    const patch: Record<string, unknown> = {};
    for (const key of COMPLIANCE_DATE_FIELDS) {
        const value = row[key];
        if (typeof value === 'string' || typeof value === 'number') patch[key] = new Date(value);
    }
    return Object.assign({}, row, patch);
}

/** The sign-offs, questionnaire and document review of a full PCA report as published, or null when the snapshot has none. */
export function frozenCompliance<C extends { reportSignoffs: unknown[]; psq: unknown; documentReview: unknown[] }>(pinned: Snapshot | null): C | null {
    const c = pinned?.compliance;
    if (!c) return null;
    return {
        reportSignoffs: c.reportSignoffs.map((r) => reviveDates(r)),
        psq: c.psq ? reviveDates(c.psq) : null,
        documentReview: c.documentReview.map((r) => reviveDates(r)),
    } as unknown as C;
}
