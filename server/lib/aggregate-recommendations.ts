import { parseFindingKey } from './finding-key';

interface AggregatedRecItem {
    recommendationId: string;
    estimateSnapshotMin: number | null;
    estimateSnapshotMax: number | null;
    summarySnapshot: string;
    contractorTypeSnapshot: string | null;
    attachedAt: number;
    itemId: string;
}

export interface AggregatedRecResult {
    items: AggregatedRecItem[];
    totals: { count: number; estimateMinSum: number; estimateMaxSum: number };
}

/**
 * Flatten attached repair items from an inspection_results.data blob.
 *
 * The editor persists each item's result under BOTH a composite key
 * (`<scope>:<sectionId>:<itemId>`) and the bare `itemId` (useFindings dual-key
 * write). We normalize every key to its bare itemId (the segment after the last
 * ':') and dedup by `(itemId, recommendationId)` so the same attachment isn't
 * counted twice — while still keeping the same recommendation attached to two
 * DIFFERENT findings as two distinct entries.
 */
export function aggregateAttachedRecommendations(data: Record<string, unknown> | null | undefined): AggregatedRecResult {
    const seen = new Set<string>();
    const items: AggregatedRecItem[] = [];
    let estimateMinSum = 0;
    let estimateMaxSum = 0;

    for (const [rawKey, rawItem] of Object.entries(data ?? {})) {
        const itemId = parseFindingKey(rawKey).itemId;
        const recs = (rawItem as { recommendations?: Array<Record<string, unknown>> } | null)?.recommendations ?? [];
        for (const rec of recs) {
            const r = rec as {
                recommendationId?: string;
                estimateSnapshotMin?: number | null;
                estimateSnapshotMax?: number | null;
                summarySnapshot?: string;
                contractorTypeSnapshot?: string | null;
                attachedAt?: number;
            };
            const recommendationId = r.recommendationId ?? '';
            const dedupKey = `${itemId}::${recommendationId}`;
            if (seen.has(dedupKey)) continue;
            seen.add(dedupKey);
            items.push({
                recommendationId,
                estimateSnapshotMin:    r.estimateSnapshotMin ?? null,
                estimateSnapshotMax:    r.estimateSnapshotMax ?? null,
                summarySnapshot:        r.summarySnapshot ?? '',
                contractorTypeSnapshot: r.contractorTypeSnapshot ?? null,
                attachedAt:             r.attachedAt ?? 0,
                itemId,
            });
            estimateMinSum += r.estimateSnapshotMin ?? 0;
            estimateMaxSum += r.estimateSnapshotMax ?? 0;
        }
    }

    return { items, totals: { count: items.length, estimateMinSum, estimateMaxSum } };
}
