/**
 * Commercial PCA Phase U — pure support logic for UnitService.createMany /
 * duplicate. No DB: the service supplies existing siblings and persists the
 * result. Kept pure so bulk/dup logic is unit-testable without D1.
 */
import type { UnitDraft } from './unit-pattern';

/** Next sortOrder = max existing + 10 (0 when empty). */
export function nextSortOrder(rows: Array<{ sortOrder: number }>): number {
    return rows.length ? Math.max(...rows.map((r) => r.sortOrder)) + 10 : 0;
}

/** Drop drafts whose label already exists among siblings or earlier in the batch. */
export function dedupeDrafts(existingNames: string[], drafts: UnitDraft[]): UnitDraft[] {
    const seen = new Set(existingNames);
    const out: UnitDraft[] = [];
    for (const d of drafts) {
        if (seen.has(d.label)) continue;
        seen.add(d.label);
        out.push(d);
    }
    return out;
}

/** Collision-safe duplicate label: "X (copy)", then "X (copy 2)", … */
export function copyName(base: string, existingNames: string[]): string {
    const taken = new Set(existingNames);
    const first = `${base} (copy)`;
    if (!taken.has(first)) return first;
    let n = 2;
    while (taken.has(`${base} (copy ${n})`)) n++;
    return `${base} (copy ${n})`;
}
