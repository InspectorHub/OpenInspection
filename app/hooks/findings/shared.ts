import type { useFetcher } from "react-router";
import type { ResultMap } from "../useInspection";
import type { OfflineQueue } from "~/lib/offline/offline-queue";

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
 * Task 6 — a repair item (Recommendation) snapshotted onto a finding. Stored
 * under `result.recommendations[]`. The aggregate read endpoint
 * (`GET /api/inspections/:id/recommendations`) and offline diff3 union both key
 * on `recommendationId`. Estimate/summary/contractor are snapshotted at attach
 * time so later catalog edits never silently rewrite a published finding.
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
/*  Shared sub-hook context                                            */
/* ------------------------------------------------------------------ */

/**
 * The state + setters + helpers shared by every findings sub-hook. The main
 * `useFindings` owns the live `results`/`setResults`/`fetcher` and threads them
 * down here so each slice sees the SAME values (no per-slice state). This is
 * what keeps the save-all fresh-map invariant intact: every save-all mutation
 * reads the same `results` the main hook was rendered with and submits the
 * freshly-computed `next` map (never a stale per-slice copy).
 */
export interface FindingsContext {
  results: ResultMap;
  setResults: (fn: (prev: ResultMap) => ResultMap) => void;
  fetcher: ReturnType<typeof useFetcher>;
  notesFetcher: ReturnType<typeof useFetcher>;
  sectionIdForItem: (itemId: string) => string | null;
  setDirty: (v: boolean) => void;
  setSaveStatus: (s: "idle" | "saving" | "saved" | "error") => void;
  /** Offline-queue write helper (shared useOfflineWrite, NOT re-created here). */
  tryEnqueueOffline: (
    intent: string,
    itemId: string | undefined,
    field: string | undefined,
    payload: Record<string, unknown>,
  ) => boolean;
  /** Read helper shared across slices (composite-key-preferred lookup). */
  getResult: (itemId: string, sectionId?: string) => Record<string, unknown>;
}

export interface FindingsOptions {
  sectionIdForItem: (itemId: string) => string | null;
  setDirty: (v: boolean) => void;
  setSaveStatus: (s: "idle" | "saving" | "saved" | "error") => void;
  inspectionId: string;
  /**
   * B-17: notes commit (textarea blur) and the next mutation (rating click)
   * fire in the same gesture. On a shared fetcher, React Router aborts the
   * in-flight notes submission when the rating submits — the note is lost.
   * Callers should pass a dedicated fetcher for notes commits.
   */
  notesFetcher?: ReturnType<typeof useFetcher>;
  /**
   * When provided, field writes are routed through the offline queue instead
   * of the fetcher when `navigator.onLine === false`.  Task 3 offline branch.
   */
  offlineQueue?: OfflineQueue;
  /** #181 — when present, the editor routes writes through the Yjs doc (collab). */
  collab?: { doc: import("yjs").Doc };
}
