import { useCallback } from "react";
import type { ResultMap } from "./useInspection";
import { fKey } from "./useInspection";
import {
  findingKey,
  cloneByScope,
  type FindingsOptions,
  type TabStateEntry,
  type CustomCommentEntry,
  type AttachedRepairItem,
} from "./findings/shared";
import { buildCollabFindingsApi, type CollabFindingsApi } from "~/lib/collab/collab-findings-api";
import type { useFetcher } from "react-router";

// Re-exported so existing imports (`~/hooks/useFindings`) keep resolving. The
// type/helper definitions live in ./findings/shared; consumers and tests see
// the same names and signatures.
export {
  findingKey,
  cloneByScope,
  type TabStateEntry,
  type CustomCommentEntry,
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

  // Composite-key-preferred read helper (shared by the collab API and the
  // pre-connect fallback below).
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

  // #181 — collab is the only write path. Once the doc is live, return the pure
  // collab write API (every write goes to the doc via the binding).
  if (options.collab?.doc) {
    return buildCollabFindingsApi(options.collab.doc, {
      getResult,
      sectionIdForItem,
      setResults,
      setDirty,
      setSaveStatus,
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
