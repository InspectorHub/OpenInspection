import { useCallback } from "react";
import { fKey } from "../useInspection";
import { attachPhotoToDefectState, attachPhotoToCustomDefect } from "~/lib/defect-photos";
import type { FindingsContext } from "./shared";

/**
 * Photo slice (FE-2 / FE-3). Both attach paths follow the
 * persist-the-freshly-computed-map discipline: read the CURRENT entry from
 * `ctx.results` (the render-time snapshot, NOT a stale per-slice copy), build
 * `next`, `setResults(() => next)` AND submit THAT `next`. Submitting the
 * closure's `results` would serialize the pre-attach photos array and silently
 * drop the new photo.
 */
export function useFindingsPhotos(ctx: FindingsContext) {
  const {
    results,
    sectionIdForItem,
    setResults,
    fetcher,
    setDirty,
    setSaveStatus,
    tryEnqueueOffline,
    getResult,
  } = ctx;

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

  return { addPhotoToItem, getPhotoCount, addPhotoToDefect };
}
