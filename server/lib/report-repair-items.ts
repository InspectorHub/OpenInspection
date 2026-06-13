/**
 * Task 8 — map snapshotted repair-item recommendations attached to a finding
 * into the report-facing shape (dollars, not cents).
 *
 * A finding's attached repair items are snapshotted at
 * `inspection_results.data[itemId].recommendations[]` as
 * `{ recommendationId, estimateSnapshotMin, estimateSnapshotMax,
 *    summarySnapshot, contractorTypeSnapshot, attachedAt }` (cents).
 *
 * Extracted to a dependency-free lib module so it can be unit-tested without
 * pulling in the heavy `inspection.service.ts` module-load graph (which imports
 * AutomationService / InvoiceService / etc.).
 */
export function mapRepairItems(res: unknown): Array<{ summary: string; estimateMin: number | null; estimateMax: number | null; contractorType: string | null }> | undefined {
    const recs = (res as { recommendations?: Array<{ summarySnapshot?: string; estimateSnapshotMin?: number | null; estimateSnapshotMax?: number | null; contractorTypeSnapshot?: string | null }> })?.recommendations;
    if (!recs || recs.length === 0) return undefined;
    const mapped = recs
        .filter((r) => (r.summarySnapshot ?? '').trim() !== '')
        .map((r) => ({
            summary: r.summarySnapshot ?? '',
            estimateMin: r.estimateSnapshotMin != null ? Math.round(r.estimateSnapshotMin / 100) : null,
            estimateMax: r.estimateSnapshotMax != null ? Math.round(r.estimateSnapshotMax / 100) : null,
            contractorType: r.contractorTypeSnapshot ?? null,
        }));
    return mapped.length > 0 ? mapped : undefined;
}
