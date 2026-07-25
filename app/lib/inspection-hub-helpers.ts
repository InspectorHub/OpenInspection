/* ------------------------------------------------------------------ */
/*  Inspection-hub shared types + pure helpers                        */
/* ------------------------------------------------------------------ */

/**
 * #119 Task 6 — a baseline report item the inspector can carry forward into a
 * re-inspection. `open` pre-checks the still-open flagged set in the modal.
 */
export interface ReinspectCandidate {
  itemId: string;
  label: string;
  originalNotes: string | null;
  open: boolean;
}

/** One published snapshot as returned by GET /inspections/:id/versions. */
export interface ReportVersionRow {
  versionNumber: number;
  publishedAt: number | null; // unix seconds
  summary: string | null;
}

/**
 * IA-40 — the version-diff page (`/version-diff/:id?n=&from=`) had no inbound
 * links anywhere in the app; the only way in was hand-typing the URL. This
 * builds the link from a version to a diff against its immediate predecessor.
 * Version 1 has nothing earlier to compare against, so it gets no link.
 *
 * Lives here rather than in the route it serves: it is pure, and its spec was
 * importing it out of `~/routes/inspection-hub`, which pulled the entire page
 * module — loader, action, every modal — in to test two string branches.
 */
export function versionDiffHref(inspectionId: string, versionNumber: number): string | null {
  if (versionNumber <= 1) return null;
  return `/version-diff/${inspectionId}?n=${versionNumber}&from=${versionNumber - 1}`;
}
