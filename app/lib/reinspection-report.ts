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
//
// ──────────────────────────────────────────────────────────────────────────
// NOT WIRED, AND DELIBERATELY SO. READ THIS BEFORE CALLING THEM. (F45)
//
// Nothing in production calls these. That is not an oversight left to be
// tidied up — it is a product decision that has not been made yet, parked as
// F76 ("changing re-inspection report output is a product decision").
//
// WHAT IS ACTUALLY TRUE TODAY, verified 2026-09-11:
//
//   - The SERVER half is complete. `getReportData` emits per-item `original`,
//     `followupStatus` and `followupNotes`, plus a top-level `reinspection`
//     block ({ round, rootInspectionId, statuses }) whenever
//     `inspections.source_inspection_id` is set. Its own comment there says
//     "the report page renders only the carried items" — describing an
//     intention, not this codebase.
//   - The APP half never receives any of it. `reportViewProps()`
//     (app/components/portal/sections/report/report-view-props.ts) is an
//     explicit field-by-field allowlist and does not carry `reinspection`;
//     `ReportLoaderResult` has no such field; and `ReportItem`
//     (../components/portal/sections/report/types.ts) has no `original`,
//     `followupStatus` or `followupNotes` at all. The string "reinspection"
//     does not occur anywhere under app/components/portal/ or in the report
//     route. The Word-export consumer does not read them either.
//   - CONSEQUENCE: a re-inspection report renders EXACTLY like a normal one —
//     every template item, every section, the full summary counts. Whatever a
//     client has already been sent is that.
//
// SO WIRING THESE WOULD CHANGE WHAT A CLIENT SEES on a published report: it
// would delete items and entire section headings from it, and move the summary
// statistics and the table of contents with them. That is the F76 decision, and
// it is not a refactor to slip in behind a "wire up the dead primitive" task.
//
// WHY THEY ARE STILL HERE rather than deleted: the rule is not wrong, it is
// unlanded. These three functions plus `reinspection-report.test.ts` are the
// only executable statement of R7 §7 anywhere in the tree, and they cost
// nothing — no dead control, no label promising a capability, nothing a user
// can reach. If F76 resolves as "a re-inspection report stays full-template",
// delete this file and its spec in that change. If it resolves the other way,
// the wiring is: add `reinspection` to `ReportLoaderResult` + `reportViewProps`,
// add the three carry fields to `ReportItem`, and filter in `ReportView` with
// `sectionsWithCarriedItems` before the sections reach `ReportSectionBlock`,
// `ReportToc` and `ReportSummaryStats`.
// ──────────────────────────────────────────────────────────────────────────

/** Minimal shape consumed by the filter.
 *
 *  This used to say "kept in sync with report.tsx's ReportItem". It is not, and
 *  cannot be: `app/routes/public/report.tsx` is now a 302 redirect stub (the
 *  renderer it named was retired for reading an obsolete shape), and the live
 *  `ReportItem` in app/components/portal/sections/report/types.ts carries no
 *  `original` field. This interface describes a payload the app does not
 *  currently construct — see the F45 note above. */
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
