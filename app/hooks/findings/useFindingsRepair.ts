import { useCallback } from "react";
import { fKey } from "../useInspection";
import type { AttachedRepairItem, FindingsContext } from "./shared";

/**
 * Repair-item slice (Task 6). Attach/detach a repair item on a finding under
 * `result.recommendations[]`. Same persist-the-freshly-computed-map discipline
 * as the photo slice: read the CURRENT entry from `ctx.results`, build `next`,
 * `setResults(() => next)` AND submit THAT `next` (never the closure's
 * `results`, which would serialize the pre-attach array and silently drop the
 * new item).
 */
export function useFindingsRepair(ctx: FindingsContext) {
  const {
    results,
    sectionIdForItem,
    setResults,
    fetcher,
    setDirty,
    setSaveStatus,
    tryEnqueueOffline,
  } = ctx;

  /** Attach a repair item to a finding (replace-or-append by recommendationId). */
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

  return { attachRepairItem, detachRepairItem };
}
