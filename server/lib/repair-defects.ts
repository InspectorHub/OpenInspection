/**
 * Shared repair-defect flatten helper.
 *
 * Used by the Interactive Repair Request Builder source endpoint
 * (`server/api/repair-builder.ts`) to flatten the report defect list into
 * a stable, keyed format.
 *
 * The RRB shape omits estimateLow/estimateHigh (RRB is pure-credit). We add
 * a stable `findingKey` so the builder can key its items against the report.
 */

export type RepairDefect = {
    findingKey:   string;
    sectionId:    string;
    sectionTitle: string;
    itemId:       string;
    itemLabel:    string;
    comment:      string;
    category:     'safety' | 'recommendation' | 'maintenance';
};

/**
 * Minimal inspection-service interface consumed by this helper.
 * Only the `getRepairList` method is required; callers pass the full
 * InspectionService instance — this interface makes the dependency explicit
 * and keeps the helper unit-testable without importing the full service.
 */
export interface InspectionSvcForDefects {
    getRepairList(
        inspectionId: string,
        tenantId: string,
    ): Promise<{
        defects: Array<{
            sectionId:        string;
            sectionTitle:     string;
            itemId:           string;
            itemLabel:        string;
            comment:          string;
            category:         'safety' | 'recommendation' | 'maintenance';
            source:           'canned' | 'custom';
            recommendationId: string | null;
        }>;
    }>;
}

/**
 * Returns a flat list of defect-rated items from a published report, each with
 * a unique, deterministic `findingKey`.
 *
 * Key format: `{source}:{sectionId}:{itemId}:{recommendationId|'custom'}`
 * When two entries would share the same base key (e.g. two custom defects on
 * the same item with no slug), a collision ordinal suffix `#N` is appended
 * starting from `#1` for the second occurrence.
 *
 * NOTE: `getRepairList` already gates on the inspection existing + being
 * tenant-scoped. The publish gate is enforced by the CALLER before invoking
 * this helper.
 */
export async function flattenReportDefects(
    inspectionSvc: InspectionSvcForDefects,
    inspectionId:  string,
    tenantId:      string,
): Promise<RepairDefect[]> {
    const { defects } = await inspectionSvc.getRepairList(inspectionId, tenantId);

    const seen = new Map<string, number>();

    return defects.map((d) => {
        const base = `${d.source}:${d.sectionId}:${d.itemId}:${d.recommendationId ?? 'custom'}`;
        const n = seen.get(base) ?? 0;
        seen.set(base, n + 1);
        const key = n === 0 ? base : `${base}#${n}`;

        return {
            findingKey:   key,
            sectionId:    d.sectionId,
            sectionTitle: d.sectionTitle,
            itemId:       d.itemId,
            itemLabel:    d.itemLabel,
            comment:      d.comment,
            category:     d.category,
        };
    });
}
