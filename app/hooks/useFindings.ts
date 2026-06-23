import type { ResultMap } from "./useInspection";
import { useOfflineWrite } from "./useOfflineWrite";
import {
  findingKey,
  cloneByScope,
  type FindingsContext,
  type FindingsOptions,
  type TabStateEntry,
  type CustomCommentEntry,
  type AttachedRepairItem,
} from "./findings/shared";
import { useFindingsCore } from "./findings/useFindingsCore";
import { useFindingsRating } from "./findings/useFindingsRating";
import { useFindingsCanned } from "./findings/useFindingsCanned";
import { useFindingsPhotos } from "./findings/useFindingsPhotos";
import { useFindingsCustom } from "./findings/useFindingsCustom";
import { useFindingsRepair } from "./findings/useFindingsRepair";
import { buildCollabFindingsApi } from "~/lib/collab/collab-findings-api";
import type { useFetcher } from "react-router";

// Re-exported so existing imports (`~/hooks/useFindings`) keep resolving. The
// type/helper definitions now live in ./findings/shared; consumers and tests
// see the same names and signatures.
export {
  findingKey,
  cloneByScope,
  type TabStateEntry,
  type CustomCommentEntry,
  type AttachedRepairItem,
};

/**
 * The inspection findings state hook: ratings, canned comments, photos, custom
 * defects, repair items, and the offline write queue. Behavior-preserving
 * decomposition (Phase 4): the per-concern mutations live in composed
 * sub-hooks under ./findings/*; this function owns the live `results` /
 * `setResults` / `fetcher`, builds the shared offline-write helper + read
 * helper once, threads them into every slice as a single context, and assembles
 * the (unchanged) return object.
 *
 * The save-all fresh-map invariant (FE-2 / FE-3) is preserved by passing the
 * SAME render-time `results` to every slice via `ctx`: each save-all mutation
 * reads that snapshot, computes `next`, and submits THAT `next` — never a stale
 * per-slice copy.
 */
export function useFindings(
  results: ResultMap,
  setResults: (fn: (prev: ResultMap) => ResultMap) => void,
  fetcher: ReturnType<typeof useFetcher>,
  options: FindingsOptions,
) {
  const { sectionIdForItem, setDirty, setSaveStatus } = options;
  const notesFetcher = options.notesFetcher ?? fetcher;
  const offlineQueue = options.offlineQueue;

  // Offline-queue write helper (version-freeze / shouldQueue / lastKnownVersion
  // semantics live in useOfflineWrite). Returns true when the write was queued
  // (caller skips the fetcher path), false otherwise. Shared across all slices.
  const tryEnqueueOffline = useOfflineWrite({
    results,
    sectionIdForItem,
    inspectionId: options.inspectionId,
    offlineQueue,
  });

  // Core slice owns the read helper + save-all serializers. `getResult` is
  // threaded back into the shared context so the other slices read through one
  // canonical lookup.
  const core = useFindingsCore({
    results,
    fetcher,
    sectionIdForItem,
    setDirty,
    setSaveStatus,
  });

  // Single shared context: every slice sees the SAME live state + setters +
  // helpers. This is what keeps the fresh-map invariant intact.
  const ctx: FindingsContext = {
    results,
    setResults,
    fetcher,
    notesFetcher,
    sectionIdForItem,
    setDirty,
    setSaveStatus,
    tryEnqueueOffline,
    getResult: core.getResult,
  };

  const rating = useFindingsRating(ctx);
  const canned = useFindingsCanned(ctx);
  const photos = useFindingsPhotos(ctx);
  const custom = useFindingsCustom(ctx);
  const repair = useFindingsRepair(ctx);

  // #181 — collab branch: when a live Y.Doc is present, return the pure collab
  // write API (every write goes to the doc via the binding) instead of the
  // legacy per-field-CAS / offline path below. The legacy return is unchanged.
  if (options.collab?.doc) {
    return buildCollabFindingsApi(options.collab.doc, {
      getResult: core.getResult,
      sectionIdForItem,
      setResults,
      setDirty,
      setSaveStatus,
    });
  }

  return {
    getResult: core.getResult,
    setRating: rating.setRating,
    setNotes: rating.setNotes,
    commitNotes: rating.commitNotes,
    setItemValue: rating.setItemValue,
    toggleCannedComment: canned.toggleCannedComment,
    setDefectFields: canned.setDefectFields,
    insertComment: canned.insertComment,
    cloneLast: rating.cloneLast,
    batchSetRating: rating.batchSetRating,
    addPhotoToItem: photos.addPhotoToItem,
    addPhotoToDefect: photos.addPhotoToDefect,
    getPhotoCount: photos.getPhotoCount,
    addCustomDefect: custom.addCustomDefect,
    toggleCustomDefect: custom.toggleCustomDefect,
    attachRepairItem: repair.attachRepairItem,
    detachRepairItem: repair.detachRepairItem,
    debounceSave: core.debounceSave,
    saveNow: core.saveNow,
  };
}
