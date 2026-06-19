import { useCallback, useRef } from "react";
import type { useFetcher } from "react-router";
import type { ResultMap } from "./useInspection";
import { fKey } from "./useInspection";
import { attachPhotoToDefectState, attachPhotoToCustomDefect } from "~/lib/defect-photos";
import { useOfflineWrite } from "./useOfflineWrite";
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
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useFindings(
  results: ResultMap,
  setResults: (fn: (prev: ResultMap) => ResultMap) => void,
  fetcher: ReturnType<typeof useFetcher>,
  options: {
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
  },
) {
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const { sectionIdForItem, setDirty, setSaveStatus } = options;
  const notesFetcher = options.notesFetcher ?? fetcher;
  const offlineQueue = options.offlineQueue;

  // Offline-queue write helper (version-freeze / shouldQueue / lastKnownVersion
  // semantics live in useOfflineWrite). Returns true when the write was queued
  // (caller skips the fetcher path), false otherwise.
  const tryEnqueueOffline = useOfflineWrite({
    results,
    sectionIdForItem,
    inspectionId: options.inspectionId,
    offlineQueue,
  });

  /* ---------------------------------------------------------------- */
  /*  Read helpers                                                     */
  /* ---------------------------------------------------------------- */

  const getResult = useCallback(
    (itemId: string, sectionId?: string): Record<string, unknown> => {
      const sid = sectionId || sectionIdForItem(itemId);
      if (sid) {
        const ck = fKey(sid, itemId);
        if (results[ck]) return results[ck];
      }
      return results[itemId] || {};
    },
    [results, sectionIdForItem],
  );

  /* ---------------------------------------------------------------- */
  /*  Debounced save                                                   */
  /* ---------------------------------------------------------------- */

  const debounceSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setDirty(true);
    setSaveStatus("saving");
    saveTimer.current = setTimeout(() => {
      fetcher.submit(
        { intent: "save-all", data: JSON.stringify(results) },
        { method: "POST" },
      );
    }, 1000);
  }, [fetcher, results, setDirty, setSaveStatus]);

  const saveNow = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveStatus("saving");
    fetcher.submit(
      { intent: "save-all", data: JSON.stringify(results) },
      { method: "POST" },
    );
  }, [fetcher, results, setSaveStatus]);

  /* ---------------------------------------------------------------- */
  /*  Mutations                                                        */
  /* ---------------------------------------------------------------- */

  const setRating = useCallback(
    (sectionId: string, itemId: string, rating: string | null) => {
      const key = fKey(sectionId, itemId);
      setResults((prev) => ({
        ...prev,
        [key]: {
          ...((prev[key] as Record<string, unknown>) || {}),
          ...((prev[itemId] as Record<string, unknown>) || {}),
          rating,
        },
        [itemId]: {
          ...((prev[key] as Record<string, unknown>) || {}),
          ...((prev[itemId] as Record<string, unknown>) || {}),
          rating,
        },
      }));
      // Fire fetcher for immediate persistence (or queue when offline)
      if (!tryEnqueueOffline("rate", itemId, "rating", { rating: rating || "", sectionId })) {
        fetcher.submit(
          { intent: "rate", itemId, sectionId, rating: rating || "" },
          { method: "POST" },
        );
      }
      setDirty(true);
    },
    [setResults, fetcher, setDirty, tryEnqueueOffline],
  );

  const setNotes = useCallback(
    (sectionId: string, itemId: string, notes: string) => {
      const key = fKey(sectionId, itemId);
      setResults((prev) => ({
        ...prev,
        [key]: {
          ...((prev[key] as Record<string, unknown>) || {}),
          ...((prev[itemId] as Record<string, unknown>) || {}),
          notes,
        },
        [itemId]: {
          ...((prev[key] as Record<string, unknown>) || {}),
          ...((prev[itemId] as Record<string, unknown>) || {}),
          notes,
        },
      }));
    },
    [setResults],
  );

  const commitNotes = useCallback(
    (sectionId: string, itemId: string, notes: string) => {
      if (!tryEnqueueOffline("notes", itemId, "notes", { notes, sectionId })) {
        notesFetcher.submit(
          { intent: "notes", itemId, sectionId, notes },
          { method: "POST" },
        );
      }
      setDirty(true);
    },
    [notesFetcher, setDirty, tryEnqueueOffline],
  );

  const setItemValue = useCallback(
    (sectionId: string, itemId: string, value: unknown) => {
      const key = fKey(sectionId, itemId);
      setResults((prev) => ({
        ...prev,
        [key]: {
          ...((prev[key] as Record<string, unknown>) || {}),
          value,
        },
        [itemId]: {
          ...((prev[key] as Record<string, unknown>) || {}),
          value,
        },
      }));
      setDirty(true);
    },
    [setResults, setDirty],
  );

  /* ---------------------------------------------------------------- */
  /*  Canned comment toggling                                          */
  /* ---------------------------------------------------------------- */

  const toggleCannedComment = useCallback(
    (
      sectionId: string,
      itemId: string,
      tabName: string,
      cannedId: string,
      included: boolean,
    ) => {
      const key = fKey(sectionId, itemId);
      setResults((prev) => {
        const existing =
          (prev[key] as Record<string, unknown>) || {};
        const existingTabs =
          (existing.tabs as Record<
            string,
            Array<{ cannedId: string; included: boolean }>
          >) || {};
        const tabEntries = [...(existingTabs[tabName] || [])];
        const idx = tabEntries.findIndex((e) => e.cannedId === cannedId);
        if (idx >= 0) {
          tabEntries[idx] = { ...tabEntries[idx], included };
        } else {
          tabEntries.push({ cannedId, included });
        }
        const updated = {
          ...existing,
          tabs: { ...existingTabs, [tabName]: tabEntries },
        };
        return {
          ...prev,
          [key]: updated,
          [itemId]: updated,
        };
      });
      if (
        !tryEnqueueOffline("toggle-canned", itemId, `canned:${tabName}:${cannedId}`, {
          tabName,
          cannedId,
          included,
          sectionId,
        })
      ) {
        fetcher.submit(
          {
            intent: "toggle-canned",
            itemId,
            sectionId,
            tabName,
            cannedId,
            included: String(included),
          },
          { method: "POST" },
        );
      }
      setDirty(true);
    },
    [setResults, fetcher, setDirty, tryEnqueueOffline],
  );

  /* ---------------------------------------------------------------- */
  /*  Defect structured fields (location / trade / deadline / timeframe) */
  /* ---------------------------------------------------------------- */

  const setDefectFields = useCallback(
    (
      sectionId: string,
      itemId: string,
      cannedId: string,
      patch: { location?: string | null; trade?: string | null; deadline?: string | null; timeframe?: string | null },
    ) => {
      const key = fKey(sectionId, itemId);
      setResults((prev) => {
        const existing = (prev[key] as Record<string, unknown>) || {};
        const existingTabs = (existing.tabs as Record<string, Array<Record<string, unknown>>>) || {};
        const defects = [...(existingTabs.defects || [])];
        const idx = defects.findIndex((d) => d.cannedId === cannedId);
        const next: Record<string, unknown> =
          idx >= 0 ? { ...defects[idx] } : { cannedId, included: true };
        if ("location"  in patch) next.location  = patch.location;
        if ("trade"     in patch) next.trade     = patch.trade;
        if ("deadline"  in patch) next.deadline  = patch.deadline;
        if ("timeframe" in patch) next.timeframe = patch.timeframe;
        if (idx >= 0) defects[idx] = next;
        else defects.push(next);
        const updated = { ...existing, tabs: { ...existingTabs, defects } };
        return { ...prev, [key]: updated, [itemId]: updated };
      });
      if (
        !tryEnqueueOffline("set-defect-fields", itemId, `defect-fields:${cannedId}`, {
          cannedId,
          sectionId,
          ...patch,
        })
      ) {
        fetcher.submit(
          {
            intent: "set-defect-fields",
            itemId,
            sectionId,
            cannedId,
            patch: JSON.stringify(patch),
          },
          { method: "POST" },
        );
      }
      setDirty(true);
    },
    [setResults, fetcher, setDirty, tryEnqueueOffline],
  );

  /* ---------------------------------------------------------------- */
  /*  Comment insertion (from library)                                  */
  /* ---------------------------------------------------------------- */

  const insertComment = useCallback(
    (
      sectionId: string,
      itemId: string,
      text: string,
      withExtraNewline = false,
    ) => {
      const key = fKey(sectionId, itemId);
      setResults((prev) => {
        const existing =
          (prev[key] as Record<string, unknown>) || {};
        const oldNotes = (existing.notes as string) || "";
        const sep = withExtraNewline ? "\n\n" : "\n";
        const newNotes = oldNotes
          ? oldNotes.trimEnd() + sep + text
          : text;
        const updated = { ...existing, notes: newNotes };
        return {
          ...prev,
          [key]: updated,
          [itemId]: updated,
        };
      });
      setDirty(true);
    },
    [setResults, setDirty],
  );

  /* ---------------------------------------------------------------- */
  /*  Repeat previous rating (R key)                                   */
  /* ---------------------------------------------------------------- */


  const cloneLast = useCallback(
    (
      sectionId: string,
      itemId: string,
      sectionItems: Array<{ id: string }>,
      scope: 'rating' | 'rating_notes' | 'all',
    ): boolean => {
      const activeIdx = sectionItems.findIndex((it) => it.id === itemId);
      let priorResult: Record<string, unknown> | null = null;
      for (let i = activeIdx - 1; i >= 0; i--) {
        const r = getResult(sectionItems[i].id, sectionId);
        if (r && r.rating) { priorResult = r; break; }
      }
      if (!priorResult) return false;
      const projected = cloneByScope(priorResult, scope);
      const key = fKey(sectionId, itemId);
      setResults((prev) => {
        const existing = (prev[key] as Record<string, unknown>) || {};
        const updated = { ...existing, ...projected };
        return { ...prev, [key]: updated, [itemId]: updated };
      });
      setDirty(true);
      return true;
    },
    [getResult, setResults, setDirty],
  );

  /* ---------------------------------------------------------------- */
  /*  Batch rating                                                     */
  /* ---------------------------------------------------------------- */

  const batchSetRating = useCallback(
    (
      sectionId: string,
      items: Array<{ id: string }>,
      selected: Record<string, boolean>,
      levelId: string,
    ) => {
      let count = 0;
      setResults((prev) => {
        const next = { ...prev };
        for (const item of items) {
          if (!selected[item.id]) continue;
          const key = fKey(sectionId, item.id);
          const existing =
            (next[key] as Record<string, unknown>) || {};
          const updated = { ...existing, rating: levelId };
          next[key] = updated;
          next[item.id] = updated;
          count++;
        }
        return next;
      });
      setDirty(true);
      return count;
    },
    [setResults, setDirty],
  );

  /* ---------------------------------------------------------------- */
  /*  Photo handling                                                    */
  /* ---------------------------------------------------------------- */

  const addPhotoToItem = useCallback(
    (itemId: string, photoKey: string) => {
      const sid = sectionIdForItem(itemId);
      if (!sid) return;
      const key = fKey(sid, itemId);
      // FE-2: persist immediately. The previous version only updated local
      // state + dirty — the photos array never reached the server unless an
      // unrelated save-all happened to fire later, so "1 photo" silently
      // vanished on reload (the R2 object survived, orphaned).
      const existing =
        (results[key] as Record<string, unknown>) ||
        (results[itemId] as Record<string, unknown>) ||
        {};
      const photos = [
        ...((existing.photos as Array<{ key: string }>) || []),
        { key: photoKey },
      ];
      const updated = { ...existing, photos };
      const next = { ...results, [key]: updated, [itemId]: updated };
      setResults(() => next);
      setDirty(true);
      setSaveStatus("saving");
      if (!tryEnqueueOffline("save-all", undefined, "results", next as Record<string, unknown>)) {
        fetcher.submit(
          { intent: "save-all", data: JSON.stringify(next) },
          { method: "POST" },
        );
      }
    },
    [results, sectionIdForItem, setResults, fetcher, setDirty, setSaveStatus, tryEnqueueOffline],
  );

  const getPhotoCount = useCallback(
    (itemId: string): number => {
      const r = getResult(itemId);
      const photos = r.photos as unknown[] | undefined;
      return Array.isArray(photos) ? photos.length : 0;
    },
    [getResult],
  );

  /**
   * FE-3 — attach an uploaded photo to a specific defect instead of the item
   * as a whole. Canned defects keep photos on their state row
   * (tabs.defects[].photos — the shape getReportData maps to defectPhotos),
   * custom defects on customComments.defects[].photos. Same persist-the-
   * computed-map discipline as addPhotoToItem.
   */
  const addPhotoToDefect = useCallback(
    (
      itemId: string,
      target: { kind: "canned" | "custom"; id: string },
      photoKey: string,
    ) => {
      const sid = sectionIdForItem(itemId);
      if (!sid) return;
      const key = fKey(sid, itemId);
      const existing =
        (results[key] as Record<string, unknown>) ||
        (results[itemId] as Record<string, unknown>) ||
        {};
      const updated =
        target.kind === "canned"
          ? attachPhotoToDefectState(existing, target.id, photoKey)
          : attachPhotoToCustomDefect(existing, target.id, photoKey);
      if (updated === existing) return; // unknown custom id — nothing to do
      const next = { ...results, [key]: updated, [itemId]: updated };
      setResults(() => next);
      setDirty(true);
      setSaveStatus("saving");
      if (!tryEnqueueOffline("save-all", undefined, "results", next as Record<string, unknown>)) {
        fetcher.submit(
          { intent: "save-all", data: JSON.stringify(next) },
          { method: "POST" },
        );
      }
    },
    [results, sectionIdForItem, setResults, fetcher, setDirty, setSaveStatus, tryEnqueueOffline],
  );

  /* ---------------------------------------------------------------- */
  /*  Custom defects (B-20)                                            */
  /* ---------------------------------------------------------------- */

  /**
   * Custom defects live under `result.customComments.defects` — the shape
   * the report renderer + dashboard stats already consume. There is no
   * per-field PATCH for them, so persistence rides the save-all intent with
   * the freshly-computed map (NOT the closure's `results`, which would race).
   */
  const addCustomDefect = useCallback(
    (sectionId: string, itemId: string, defect: CustomCommentEntry) => {
      const key = fKey(sectionId, itemId);
      const existing =
        (results[key] as Record<string, unknown>) ||
        (results[itemId] as Record<string, unknown>) ||
        {};
      const cc = (existing.customComments ?? {}) as { defects?: CustomCommentEntry[] };
      const updated = {
        ...existing,
        customComments: { ...cc, defects: [...(cc.defects ?? []), defect] },
      };
      const next = { ...results, [key]: updated, [itemId]: updated };
      setResults(() => next);
      setDirty(true);
      setSaveStatus("saving");
      if (!tryEnqueueOffline("save-all", undefined, "results", next as Record<string, unknown>)) {
        fetcher.submit(
          { intent: "save-all", data: JSON.stringify(next) },
          { method: "POST" },
        );
      }
    },
    [results, setResults, fetcher, setDirty, setSaveStatus, tryEnqueueOffline],
  );

  const toggleCustomDefect = useCallback(
    (sectionId: string, itemId: string, customId: string, included: boolean) => {
      const key = fKey(sectionId, itemId);
      const existing =
        (results[key] as Record<string, unknown>) ||
        (results[itemId] as Record<string, unknown>) ||
        {};
      const cc = (existing.customComments ?? {}) as { defects?: CustomCommentEntry[] };
      const updated = {
        ...existing,
        customComments: {
          ...cc,
          defects: (cc.defects ?? []).map((d) =>
            d.id === customId ? { ...d, included } : d,
          ),
        },
      };
      const next = { ...results, [key]: updated, [itemId]: updated };
      setResults(() => next);
      setDirty(true);
      setSaveStatus("saving");
      if (!tryEnqueueOffline("save-all", undefined, "results", next as Record<string, unknown>)) {
        fetcher.submit(
          { intent: "save-all", data: JSON.stringify(next) },
          { method: "POST" },
        );
      }
    },
    [results, setResults, fetcher, setDirty, setSaveStatus, tryEnqueueOffline],
  );

  /* ---------------------------------------------------------------- */
  /*  Repair items (Task 6)                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Attach a repair item to a finding (replace-or-append by recommendationId).
   * Same persist-the-freshly-computed-map discipline as addPhotoToItem: we read
   * the CURRENT entry from `results`, build the next blob, setResults(() => next)
   * AND submit THAT `next` (never the closure's `results`, which would serialize
   * the pre-attach array and silently drop the new item).
   */
  const attachRepairItem = useCallback(
    (itemId: string, snap: AttachedRepairItem) => {
      const sid = sectionIdForItem(itemId);
      if (!sid) return;
      const key = fKey(sid, itemId);
      const existing =
        (results[key] as Record<string, unknown>) ||
        (results[itemId] as Record<string, unknown>) ||
        {};
      const current = (existing.recommendations as AttachedRepairItem[]) || [];
      const idx = current.findIndex((r) => r.recommendationId === snap.recommendationId);
      const recommendations =
        idx >= 0
          ? current.map((r, i) => (i === idx ? snap : r))
          : [...current, snap];
      const updated = { ...existing, recommendations };
      const next = { ...results, [key]: updated, [itemId]: updated };
      setResults(() => next);
      setDirty(true);
      setSaveStatus("saving");
      if (!tryEnqueueOffline("save-all", undefined, "results", next as Record<string, unknown>)) {
        fetcher.submit(
          { intent: "save-all", data: JSON.stringify(next) },
          { method: "POST" },
        );
      }
    },
    [results, sectionIdForItem, setResults, fetcher, setDirty, setSaveStatus, tryEnqueueOffline],
  );

  /** Detach a repair item from a finding (filter out by recommendationId). */
  const detachRepairItem = useCallback(
    (itemId: string, recommendationId: string) => {
      const sid = sectionIdForItem(itemId);
      if (!sid) return;
      const key = fKey(sid, itemId);
      const existing =
        (results[key] as Record<string, unknown>) ||
        (results[itemId] as Record<string, unknown>) ||
        {};
      const current = (existing.recommendations as AttachedRepairItem[]) || [];
      const recommendations = current.filter((r) => r.recommendationId !== recommendationId);
      if (recommendations.length === current.length) return; // nothing to detach
      const updated = { ...existing, recommendations };
      const next = { ...results, [key]: updated, [itemId]: updated };
      setResults(() => next);
      setDirty(true);
      setSaveStatus("saving");
      if (!tryEnqueueOffline("save-all", undefined, "results", next as Record<string, unknown>)) {
        fetcher.submit(
          { intent: "save-all", data: JSON.stringify(next) },
          { method: "POST" },
        );
      }
    },
    [results, sectionIdForItem, setResults, fetcher, setDirty, setSaveStatus, tryEnqueueOffline],
  );

  return {
    getResult,
    setRating,
    setNotes,
    commitNotes,
    setItemValue,
    toggleCannedComment,
    setDefectFields,
    insertComment,
    cloneLast,
    batchSetRating,
    addPhotoToItem,
    addPhotoToDefect,
    getPhotoCount,
    addCustomDefect,
    toggleCustomDefect,
    attachRepairItem,
    detachRepairItem,
    debounceSave,
    saveNow,
  };
}
