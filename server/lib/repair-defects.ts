/**
 * Shared repair-defect flatten helper.
 *
 * Extracted so both the legacy public repair-request export
 * (`server/api/repair-requests.ts`) and the new Interactive Repair Request
 * Builder source endpoint (`server/api/repair-builder.ts`) can share the same
 * flatten without duplicating the loop.
 *
 * The RRB shape omits estimateLow/estimateHigh (RRB is pure-credit; estimates
 * are a display concern for the old static export, not for the builder). We add
 * a stable `findingKey` so the builder can key its items against the report.
 */

import { findingKey } from './finding-key';

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
            sectionId:    string;
            sectionTitle: string;
            itemId:       string;
            itemLabel:    string;
            comment:      string;
            category:     'safety' | 'recommendation' | 'maintenance';
        }>;
    }>;
}

/**
 * Returns a flat list of defect-rated items from a published report, keyed
 * with a stable `findingKey` (unit=_default, same derivation as the
 * inspection editor).
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

    return defects.map((d) => ({
        findingKey:   findingKey(null, d.sectionId, d.itemId),
        sectionId:    d.sectionId,
        sectionTitle: d.sectionTitle,
        itemId:       d.itemId,
        itemLabel:    d.itemLabel,
        comment:      d.comment,
        category:     d.category,
    }));
}
