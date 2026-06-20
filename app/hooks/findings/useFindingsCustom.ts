import { useCallback } from "react";
import { fKey } from "../useInspection";
import type { CustomCommentEntry, FindingsContext } from "./shared";

/**
 * Custom-defect slice (B-20). Custom defects live under
 * `result.customComments.defects` — the shape the report renderer + dashboard
 * stats already consume. There is no per-field PATCH for them, so persistence
 * rides the save-all intent with the FRESHLY-computed map (NOT the closure's
 * `results`, which would race). Same discipline as the photo slice.
 */
export function useFindingsCustom(ctx: FindingsContext) {
  const {
    results,
    setResults,
    fetcher,
    setDirty,
    setSaveStatus,
    tryEnqueueOffline,
  } = ctx;

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

  return { addCustomDefect, toggleCustomDefect };
}
