/**
 * Commercial PCA Phase U (Batch C2a) — per-unit progress summary.
 *
 * Server-side computation that feeds the scope switcher's UnitProgress WITHOUT
 * shipping the full results map to the client (the whole point of the lazy
 * read-slicing). Given the single stored `inspection_results.data` map, the
 * inspection's template snapshot, and the inspection's unit ids, it counts —
 * per unit and for the `_default` common scope — how many findings carry a
 * truthy `rating`, against the template's total item count.
 *
 * Cost is O(units × findings): each `findingsForUnit` is a single prefix scan of
 * the map, and `total` is computed once. The caller reads exactly one results
 * row; nothing here mutates or re-serializes the map.
 */
import { findingsForUnit, findingKeysFromTemplateSnapshot, DEFAULT_UNIT } from './finding-key';

interface UnitProgress {
    unitId: string;
    rated: number;
    total: number;
}

export interface UnitProgressSummary {
    /** Per-unit rated/total counts, in the order the unit ids were supplied. */
    units: UnitProgress[];
    /** Rated findings in the `_default` common scope. */
    commonRated: number;
    /** Template item count — the denominator every scope is measured against. */
    total: number;
}

/** Count findings in an already-scope-sliced map that carry a truthy rating. */
function countRated(scoped: Record<string, unknown>): number {
    let n = 0;
    for (const v of Object.values(scoped)) {
        if (v && typeof v === 'object' && (v as { rating?: unknown }).rating) n++;
    }
    return n;
}

export function computeUnitProgress(
    data: Record<string, unknown>,
    templateSnapshot: unknown,
    unitIds: string[],
): UnitProgressSummary {
    const total = findingKeysFromTemplateSnapshot(templateSnapshot).length;
    const units = unitIds.map((unitId) => ({
        unitId,
        rated: countRated(findingsForUnit(data, unitId)),
        total,
    }));
    const commonRated = countRated(findingsForUnit(data, DEFAULT_UNIT));
    return { units, commonRated, total };
}
