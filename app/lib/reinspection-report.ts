// #119 (R7) — re-inspection report rendering helpers.
//
// A re-inspection seeds `inspection_results.data` for ONLY the carried
// (selected) items, each `{ original: {...}, followupStatus }`. The server's
// getReportData, however, builds `sections[].items` from the FULL template
// snapshot, so non-carried items arrive with `original == null` (no data
// entry). The spec (R7, §7) requires the re-inspection report to render ONLY
// the carried items — those with `original != null` — and to drop sections
// that end up with zero carried items (no empty section headers).
//
// These are PURE helpers so the filtering rule is unit-testable in isolation.

/** Minimal shape consumed by the filter — kept in sync with report.tsx's
 *  ReportItem. Only `original` is load-bearing for the carried test. */
export interface CarriableItem {
  original?: { rating: string | null; notes: string | null; photos: unknown[] } | null;
}

export interface CarriableSection<I extends CarriableItem> {
  items?: I[];
}

/** A template item is "carried" in this re-inspection iff it has an `original`
 *  payload (i.e. there was an `inspection_results.data` entry for it). */
export function isCarried(item: CarriableItem): boolean {
  return item.original != null;
}

/** Flatten all carried items across sections (carried = `original != null`). */
export function carriedItems<I extends CarriableItem>(
  sections: Array<CarriableSection<I>>,
): I[] {
  return sections.flatMap((section) => (section.items ?? []).filter(isCarried));
}

/** Return each section with its items narrowed to the carried ones, dropping
 *  sections that have no carried items (so no empty section header renders). */
export function sectionsWithCarriedItems<I extends CarriableItem, S extends CarriableSection<I>>(
  sections: S[],
): Array<S & { items: I[] }> {
  return sections
    .map((section) => ({ ...section, items: (section.items ?? []).filter(isCarried) }))
    .filter((section) => section.items.length > 0);
}
