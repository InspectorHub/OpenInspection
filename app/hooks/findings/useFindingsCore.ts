import { useCallback, useRef } from "react";
import type { useFetcher } from "react-router";
import type { ResultMap } from "../useInspection";
import { fKey } from "../useInspection";

/**
 * Core findings slice: the shared read helper (`getResult`) plus the two
 * save-all serializers (`debounceSave` / `saveNow`). `getResult` is threaded
 * back into the shared context so the Rating/Photos/Custom/Repair slices read
 * results through one canonical lookup.
 */
export function useFindingsCore(ctx: {
  results: ResultMap;
  fetcher: ReturnType<typeof useFetcher>;
  sectionIdForItem: (itemId: string) => string | null;
  setDirty: (v: boolean) => void;
  setSaveStatus: (s: "idle" | "saving" | "saved" | "error") => void;
}) {
  const { results, fetcher, sectionIdForItem, setDirty, setSaveStatus } = ctx;
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

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

  return { getResult, debounceSave, saveNow };
}
