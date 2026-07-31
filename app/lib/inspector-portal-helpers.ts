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
 * importing it out of `~/routes/inspector-portal`, which pulled the entire page
 * module — loader, action, every modal — in to test two string branches.
 */
export function versionDiffHref(inspectionId: string, versionNumber: number): string | null {
  if (versionNumber <= 1) return null;
  return `/version-diff/${inspectionId}?n=${versionNumber}&from=${versionNumber - 1}`;
}

/**
 * Task 4 (two-layer role model) — the publish decision off /api/auth/me.
 *
 * Reads the SERVER's resolved capability, never the role string. The loader
 * used to re-implement ROLE_DEFAULTS as `new Set(['owner','manager',
 * 'inspector']).has(role)`, which ignored permission_overrides — an inspector
 * with publish withdrawn was shown the Publish button and got a 403 on click.
 * A body without a capabilities object (an older server, a failed fetch)
 * resolves false: the submit-only flow is the safe wrong answer.
 */
export function publishCapFromMe(meBody: {
  data?: { user?: { role?: string }; capabilities?: { publish?: boolean } };
}): boolean {
  return meBody.data?.capabilities?.publish === true;
}

/**
 * Roadmap §7.5 item 1 — whether the viewer may see the Communication section.
 * Same fail-closed contract as publishCapFromMe: the server's resolved bit or
 * nothing. The API 403s the payload anyway; hiding the section keeps the page
 * from rendering a card whose every expand would error.
 */
export function viewCommunicationCapFromMe(meBody: {
  data?: { capabilities?: { viewCommunication?: boolean } };
}): boolean {
  return meBody.data?.capabilities?.viewCommunication === true;
}
