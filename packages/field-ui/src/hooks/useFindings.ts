import { useCallback, useEffect, useRef } from "react";
import type { ResultMap } from "../data-source-types";
import {
  findingKey,
  type FindingsOptions,
  type AttachedRepairItem,
} from "./findings/shared";
import { buildCollabFindingsApi, type CollabFindingsApi } from "../collab/collab-findings-api";

// Re-exported so existing imports (`~/hooks/useFindings`) keep resolving. The
// type/helper definitions live in ./findings/shared; consumers and tests see
// the same names and signatures.
export {
  type AttachedRepairItem,
};

/**
 * The inspection findings state hook: ratings, canned comments, photos, custom
 * defects, and repair items.
 *
 * #181 (Phase 5) — collaboration is unconditional. Every write routes through
 * the live Y.Doc via {@link buildCollabFindingsApi}; the legacy per-field CAS /
 * offline-queue write path was retired. The editor always supplies `collab.doc`
 * once the doc connects (a client-only effect), so this hook only has to bridge
 * the brief SSR / first-paint window before the connection initialises.
 *
 * #477 — that window used to SILENTLY DROP writes: the pre-connect fallback
 * was inert no-ops that still reported "saved". Writes made before the doc
 * connects are now QUEUED here and flushed through the live API the moment
 * the doc arrives, and while they wait the indicator reads "saving" — never
 * "saved". A write that has not reached the server is never reported as saved.
 */
export function useFindings(
  results: ResultMap,
  setResults: (fn: (prev: ResultMap) => ResultMap) => void,
  options: FindingsOptions,
) {
  const { sectionIdForItem, setDirty, setSaveStatus } = options;
  // Phase U (Batch C1) — active per-unit scope (null = `_default` common scope).
  const activeUnitId = options.activeUnitId ?? null;

  // #477 — pre-connect write queue (see above). Held in a ref so it survives
  // the re-renders between first paint and the doc connecting.
  const pendingWritesRef = useRef<Array<(api: CollabFindingsApi) => void>>([]);
  const doc = options.collab?.doc ?? null;

  // Composite-key-preferred read helper (shared by the collab API and the
  // pre-connect fallback below). Phase U: resolve the composite key under the
  // ACTIVE unit. The bare-itemId fallback is only consulted in the `_default`
  // view — in per-unit mode two units share an itemId, so the bare key is
  // ambiguous and must never let one unit shadow another.
  const getResult = useCallback(
    (itemId: string, sectionId?: string): Record<string, unknown> => {
      const sid = sectionId || sectionIdForItem(itemId);
      if (sid) {
        const ck = findingKey(activeUnitId, sid, itemId);
        if (results[ck]) return results[ck];
      }
      if (activeUnitId == null) return results[itemId] || {};
      return {};
    },
    [results, sectionIdForItem, activeUnitId],
  );

  // Flush the queued writes through the live API once the doc exists. Runs
  // only when there is something queued; the flush reports 'saved-local'
  // (in the doc, not yet server-confirmed) and the editor promotes it to
  // 'saved' on the collab sync step.
  useEffect(() => {
    if (!doc) return;
    const queued = pendingWritesRef.current;
    if (queued.length === 0) return;
    pendingWritesRef.current = [];
    const api = buildCollabFindingsApi(doc, {
      getResult,
      sectionIdForItem,
      setResults,
      setDirty,
      setSaveStatus,
      activeUnitId,
    });
    for (const write of queued) write(api);
    setDirty(true);
    setSaveStatus("saved-local");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  // #181 — collab is the only write path. Once the doc is live, return the pure
  // collab write API (every write goes to the doc via the binding).
  if (options.collab?.doc) {
    return buildCollabFindingsApi(options.collab.doc, {
      getResult,
      sectionIdForItem,
      setResults,
      setDirty,
      setSaveStatus,
      activeUnitId,
    });
  }

  // Pre-connect window (SSR / first paint, before the doc connects). Reads
  // work; writes are QUEUED (#477) and flushed by the effect above the
  // moment the doc arrives, so a tap in this window is never a silent
  // no-op. While writes wait the indicator reads "saving" — never "saved".
  // This window closes within a tick of mount when `useResultsDoc` sets the
  // live handle. `cloneLast` / `batchSetRating` / `addVideoToItem` are the
  // exceptions: they answer from current state (or report placement), so
  // they keep reporting "not written" instead of queueing a stale read.
  const queueWrite = (write: (api: CollabFindingsApi) => void): void => {
    pendingWritesRef.current.push(write);
    setSaveStatus("saving");
  };
  // A save flush with nothing queued has nothing to wait for: leave the
  // status alone rather than claiming anything.
  const pendingSave = (): void => {
    if (pendingWritesRef.current.length > 0) setSaveStatus("saving");
  };
  const fallback: CollabFindingsApi = {
    getResult,
    setRating: (sectionId, itemId, rating) => queueWrite((api) => api.setRating(sectionId, itemId, rating)),
    setNotes: (sectionId, itemId, notes) => queueWrite((api) => api.setNotes(sectionId, itemId, notes)),
    commitNotes: (sectionId, itemId, notes) => queueWrite((api) => api.commitNotes(sectionId, itemId, notes)),
    setItemValue: (sectionId, itemId, value) => queueWrite((api) => api.setItemValue(sectionId, itemId, value)),
    setItemAttribute: (sectionId, itemId, attributeId, value) => queueWrite((api) => api.setItemAttribute(sectionId, itemId, attributeId, value)),
    toggleCannedComment: (sectionId, itemId, tabName, cannedId, included) => queueWrite((api) => api.toggleCannedComment(sectionId, itemId, tabName, cannedId, included)),
    setDefectFields: (sectionId, itemId, cannedId, patch) => queueWrite((api) => api.setDefectFields(sectionId, itemId, cannedId, patch)),
    insertComment: (sectionId, itemId, text, withExtraNewline) => queueWrite((api) => api.insertComment(sectionId, itemId, text, withExtraNewline)),
    cloneLast: () => false,
    batchSetRating: () => 0,
    addPhotoToItem: (itemId, photoKey) => queueWrite((api) => api.addPhotoToItem(itemId, photoKey)),
    addVideoToItem: () => false,
    addPhotoToDefect: (itemId, target, photoKey) => queueWrite((api) => api.addPhotoToDefect(itemId, target, photoKey)),
    orderPhotoBatch: (itemId, selection) => queueWrite((api) => api.orderPhotoBatch(itemId, selection)),
    getPhotoCount: (itemId: string) => {
      const photos = getResult(itemId).photos as unknown[] | undefined;
      return Array.isArray(photos) ? photos.length : 0;
    },
    addCustomDefect: (sectionId, itemId, defect) => queueWrite((api) => api.addCustomDefect(sectionId, itemId, defect)),
    toggleCustomDefect: (sectionId, itemId, customId, included) => queueWrite((api) => api.toggleCustomDefect(sectionId, itemId, customId, included)),
    attachRepairItem: (itemId, snap) => queueWrite((api) => api.attachRepairItem(itemId, snap)),
    detachRepairItem: (itemId, recommendationId) => queueWrite((api) => api.detachRepairItem(itemId, recommendationId)),
    debounceSave: pendingSave,
    saveNow: pendingSave,
  };
  return fallback;
}
