import { useCallback, useEffect, useRef, useState } from "react";
import type { ResultMap } from "../data-source-types";
import {
  findingKey,
  type FindingsOptions,
  type AttachedRepairItem,
} from "./findings/shared";
import { buildCollabFindingsApi, type CollabFindingsApi } from "../collab/collab-findings-api";

/**
 * How long the pre-sync write queue waits for the first collab sync before
 * flushing into the local doc anyway (dead-socket backstop — see below).
 * Exported for tests; the editor never tunes it.
 */
export const PRE_SYNC_FLUSH_TIMEOUT_MS = 10_000;

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
 *
 * Early-edit race — the same queue covers the window AFTER the doc connects
 * but BEFORE the first collab sync completes. A write in that window seeds
 * the finding's structure locally (getOrSeedItem) while the server seeds the
 * identical structure from the template, and the Yjs merge keeps ONE seed
 * subtree (higher clientID wins) and silently drops the other's edits — a
 * coin flip on random clientIDs. So a connected-but-unsynced doc is treated
 * like the pre-connect window: writes queue here and flush once the first
 * sync lands, when the doc holds the server-seeded structure. `setNotes` is
 * the exception: it is the optimistic keystroke echo (React state only, no
 * doc write), so it applies immediately and typing never freezes while doc
 * writes wait.
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
  // Early-edit race (see above): a connected-but-unsynced doc queues writes
  // exactly like a missing doc. `synced` is optional — a caller that does not
  // pass it keeps the old behaviour (live writes as soon as the doc exists).
  const collabSynced = options.collab?.synced ?? true;
  // Dead-socket backstop: if the first sync never arrives (offline, or the
  // socket never opens), the queue must still reach the local doc — otherwise
  // an offline user's edits live only in React state and vanish on reload.
  // Ten seconds is well past a healthy handshake and short enough that an
  // offline edit lands in the doc promptly. Flushing on a slow-but-alive
  // connection could still meet the losing seed, but a >10s first sync is
  // pathological; the normal path flushes on sync.
  const [syncTimedOut, setSyncTimedOut] = useState(false);
  useEffect(() => {
    if (!doc || collabSynced) return;
    setSyncTimedOut(false);
    const timer = setTimeout(() => setSyncTimedOut(true), PRE_SYNC_FLUSH_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [doc, collabSynced]);
  const ready = doc !== null && (collabSynced || syncTimedOut);

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

  // Flush the queued writes through the live API once the doc is ready (it
  // exists AND the first sync landed, or the sync-timeout backstop fired).
  // Runs only when there is something queued; the flush reports 'saved-local'
  // (in the doc, not yet server-confirmed) and the editor promotes it to
  // 'saved' on the collab sync step.
  useEffect(() => {
    if (!doc || !ready) return;
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
  }, [doc, ready]);

  // The doc-built API (only when the doc exists). The live path returns it
  // 1:1; the pre-sync fallback borrows ONLY its setNotes — the optimistic
  // keystroke echo, which touches React state and never the doc — so typing
  // never freezes while doc writes wait for the sync.
  const docApi = doc
    ? buildCollabFindingsApi(doc, {
        getResult,
        sectionIdForItem,
        setResults,
        setDirty,
        setSaveStatus,
        activeUnitId,
      })
    : null;

  // #181 — collab is the only write path. Once the doc is live AND synced,
  // return the pure collab write API (every write goes to the doc via the
  // binding). Before the first sync the fallback below queues doc writes
  // instead (early-edit race — see above).
  if (ready && docApi) {
    return docApi;
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
    // setNotes is the optimistic keystroke echo (React state only, no doc
    // write): apply it immediately when the doc exists so typing never
    // freezes while doc writes wait for the sync. Before the doc connects
    // there is nothing to echo into yet, so it queues like any other write.
    setNotes: (sectionId, itemId, notes) => {
      if (docApi) docApi.setNotes(sectionId, itemId, notes);
      else queueWrite((api) => api.setNotes(sectionId, itemId, notes));
    },
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
