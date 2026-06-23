import type { useFetcher } from "react-router";

const DEFAULT_UNIT = "_default";

/** Build a composite key: `unitId:sectionId:itemId` */
export function findingKey(
  unitId: string | null,
  sectionId: string,
  itemId: string,
): string {
  return `${unitId || DEFAULT_UNIT}:${sectionId}:${itemId}`;
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface TabStateEntry {
  cannedId: string;
  included: boolean;
  comment?: string;
  category?: string;
  location?: string;
  photos?: Array<{ key: string }>;
  recommendationId?: string | null;
  estimateLow?: number | null;
  estimateHigh?: number | null;
}

export interface CustomCommentEntry {
  id: string;
  title: string;
  comment: string;
  included: boolean;
  category?: string;
  location?: string;
  photos?: Array<{ key: string }>;
}

/**
 * A repair item (Recommendation) snapshotted onto a finding. Stored under
 * `result.recommendations[]`. The aggregate read endpoint
 * (`GET /api/inspections/:id/recommendations`) keys on `recommendationId`.
 * Estimate/summary/contractor are snapshotted at attach time so later catalog
 * edits never silently rewrite a published finding.
 */
export interface AttachedRepairItem {
  recommendationId: string;
  estimateSnapshotMin: number | null;
  estimateSnapshotMax: number | null;
  summarySnapshot: string;
  contractorTypeSnapshot: string | null;
  attachedAt: number;
}

/* ------------------------------------------------------------------ */
/*  Pure helpers                                                       */
/* ------------------------------------------------------------------ */

export function cloneByScope(
    src: Record<string, unknown>,
    scope: 'rating' | 'rating_notes' | 'all',
): Record<string, unknown> {
    if (scope === 'all') return { ...src };
    if (scope === 'rating_notes') {
        const next: Record<string, unknown> = {};
        if ('rating' in src) next.rating = src.rating;
        if ('notes' in src)  next.notes  = src.notes;
        return next;
    }
    const next: Record<string, unknown> = {};
    if ('rating' in src) next.rating = src.rating;
    return next;
}

/* ------------------------------------------------------------------ */
/*  Options                                                            */
/* ------------------------------------------------------------------ */

export interface FindingsOptions {
  sectionIdForItem: (itemId: string) => string | null;
  setDirty: (v: boolean) => void;
  setSaveStatus: (s: "idle" | "saving" | "saved" | "error") => void;
  inspectionId: string;
  /**
   * Notes commit (textarea blur) and the next mutation (rating click) fire in
   * the same gesture. On a shared fetcher, React Router aborts the in-flight
   * notes submission when the rating submits — the note is lost. Callers pass a
   * dedicated fetcher for notes commits.
   */
  notesFetcher?: ReturnType<typeof useFetcher>;
  /** #181 — the editor routes every write through the Yjs doc (collab). */
  collab?: { doc: import("yjs").Doc };
}
