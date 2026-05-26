import { useCallback, useRef } from "react";
import type { useFetcher } from "react-router";
import type { ResultMap, SchemaItem, RatingLevel } from "./useInspection";
import { fKey } from "./useInspection";

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
  },
) {
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const { sectionIdForItem, setDirty, setSaveStatus, inspectionId } = options;

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
      // Fire fetcher for immediate persistence
      fetcher.submit(
        { intent: "rate", itemId, sectionId, rating: rating || "" },
        { method: "POST" },
      );
      setDirty(true);
    },
    [setResults, fetcher, setDirty],
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
      fetcher.submit(
        { intent: "notes", itemId, sectionId, notes },
        { method: "POST" },
      );
      setDirty(true);
    },
    [fetcher, setDirty],
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
      setDirty(true);
    },
    [setResults, fetcher, setDirty],
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

  const repeatPreviousRating = useCallback(
    (
      sectionId: string,
      itemId: string,
      sectionItems: Array<{ id: string }>,
    ): boolean => {
      const activeIdx = sectionItems.findIndex((it) => it.id === itemId);
      let priorResult: Record<string, unknown> | null = null;
      for (let i = activeIdx - 1; i >= 0; i--) {
        const r = getResult(sectionItems[i].id, sectionId);
        if (r && r.rating) {
          priorResult = r;
          break;
        }
      }
      if (!priorResult) return false;
      // Clone entire result to active item
      const key = fKey(sectionId, itemId);
      const cloned = JSON.parse(JSON.stringify(priorResult));
      setResults((prev) => ({
        ...prev,
        [key]: cloned,
        [itemId]: cloned,
      }));
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
      setResults((prev) => {
        const existing =
          (prev[key] as Record<string, unknown>) || {};
        const photos = [
          ...((existing.photos as Array<{ key: string }>) || []),
          { key: photoKey },
        ];
        const updated = { ...existing, photos };
        return { ...prev, [key]: updated, [itemId]: updated };
      });
      setDirty(true);
    },
    [sectionIdForItem, setResults, setDirty],
  );

  const getPhotoCount = useCallback(
    (itemId: string): number => {
      const r = getResult(itemId);
      const photos = r.photos as unknown[] | undefined;
      return Array.isArray(photos) ? photos.length : 0;
    },
    [getResult],
  );

  return {
    getResult,
    setRating,
    setNotes,
    commitNotes,
    setItemValue,
    toggleCannedComment,
    insertComment,
    repeatPreviousRating,
    batchSetRating,
    addPhotoToItem,
    getPhotoCount,
    debounceSave,
    saveNow,
  };
}
