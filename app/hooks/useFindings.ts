import { useCallback } from "react";
import type { ResultMap } from "./useInspection";
import {
  findingKey,
  type FindingsOptions,
  type AttachedRepairItem,
} from "./findings/shared";
import { buildCollabFindingsApi, type CollabFindingsApi } from "~/lib/collab/collab-findings-api";
import type { useFetcher } from "react-router";

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
 * the brief SSR / first-paint window before the connection initialises — during
 * which it returns a read-only / local-optimistic API (no persistence), because
 * the editor cannot accept user input before its first paint anyway.
 */
export function useFindings(
  results: ResultMap,
  setResults: (fn: (prev: ResultMap) => ResultMap) => void,
  _fetcher: ReturnType<typeof useFetcher>,
  options: FindingsOptions,
) {
  const { sectionIdForItem, setDirty, setSaveStatus } = options;
  // Phase U (Batch C1) — active per-unit scope (null = `_default` common scope).
  const activeUnitId = options.activeUnitId ?? null;

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

  // Pre-connect window (SSR / first paint, before the doc connects). The editor
  // renders but cannot yet persist. Reads work; writes are inert no-ops with a
  // settled save status so the indicator never hangs. This window closes within
  // a tick of mount when `useResultsDoc` sets the live handle.
  const noop = () => {};
  const settled = () => setSaveStatus("saved");
  const fallback: CollabFindingsApi = {
    getResult,
    setRating: noop,
    setNotes: noop,
    commitNotes: noop,
    setItemValue: noop,
    toggleCannedComment: noop,
    setDefectFields: noop,
    insertComment: noop,
    cloneLast: () => false,
    batchSetRating: () => 0,
    addPhotoToItem: noop,
    addPhotoToDefect: noop,
    getPhotoCount: (itemId: string) => {
      const photos = getResult(itemId).photos as unknown[] | undefined;
      return Array.isArray(photos) ? photos.length : 0;
    },
    addCustomDefect: noop,
    toggleCustomDefect: noop,
    attachRepairItem: noop,
    detachRepairItem: noop,
    debounceSave: settled,
    saveNow: settled,
  };
  return fallback;
}
