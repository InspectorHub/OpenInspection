import { useCallback } from "react";
import { fKey } from "../useInspection";
import { cloneByScope, type FindingsContext } from "./shared";

/**
 * Rating / notes / value slice: per-field single-intent mutations (rate, notes,
 * set-value) plus the rating helpers (cloneLast / batchSetRating). All use the
 * functional `setResults` updater form and route single-field writes through
 * `tryEnqueueOffline` first.
 */
export function useFindingsRating(ctx: FindingsContext) {
  const {
    setResults,
    fetcher,
    notesFetcher,
    setDirty,
    tryEnqueueOffline,
    getResult,
  } = ctx;

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

  return { setRating, setNotes, commitNotes, setItemValue, cloneLast, batchSetRating };
}
