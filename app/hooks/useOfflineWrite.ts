import { useCallback } from "react";
import type { ResultMap } from "./useInspection";
import { fKey } from "./useInspection";
import { shouldQueue } from "~/lib/offline/should-queue";
import { lastKnownVersion } from "~/lib/offline/field-version-key";
import type { OfflineQueue } from "~/lib/offline/offline-queue";

/**
 * The offline-queue write helper, extracted from useFindings so the version-
 * freeze / shouldQueue / lastKnownVersion semantics live in one place.
 *
 * Optimistic-concurrency: for the versioned single-field intents we freeze
 * the field's last-known `<field>_v` (from the in-memory ResultMap, which the
 * /results loader serializes verbatim) into the payload as `expectedVersion`.
 * Replay then sends a REAL version check (force:false) so a concurrent edit
 * lands as a 409 conflict instead of being silently overwritten — offline is
 * the widest conflict window, so this matters most here. Whole-blob intents
 * (save-all) have no per-field counter → lastKnownVersion returns null and we
 * enqueue the payload as-is.
 */
export function useOfflineWrite(options: {
  results: ResultMap;
  sectionIdForItem: (itemId: string) => string | null;
  inspectionId: string;
  offlineQueue?: OfflineQueue;
}): (
  intent: string,
  itemId: string | undefined,
  field: string | undefined,
  payload: Record<string, unknown>,
) => boolean {
  const { results, sectionIdForItem, inspectionId, offlineQueue } = options;

  /**
   * If offline and an offlineQueue is provided, enqueue the write and return
   * true (caller should skip the fetcher path).  Otherwise return false.
   */
  return useCallback(
    (
      intent: string,
      itemId: string | undefined,
      field: string | undefined,
      payload: Record<string, unknown>,
    ): boolean => {
      if (!offlineQueue) return false;
      const nav = typeof navigator !== "undefined" ? navigator : undefined;
      if (!shouldQueue(nav)) return false;

      let outPayload = payload;
      if (itemId) {
        // Same lookup as getResult(): prefer the composite key, fall back to
        // the bare itemId for legacy entries.
        const sid =
          (payload.sectionId as string | undefined) || sectionIdForItem(itemId);
        const entry = (sid && results[fKey(sid, itemId)]) || results[itemId];
        const known = lastKnownVersion(entry, intent);
        if (known !== null) {
          outPayload = { ...payload, expectedVersion: known };
        }
      }

      void offlineQueue.enqueueWrite({
        inspectionId,
        itemId,
        field,
        intent,
        payload: outPayload,
        enqueuedAt: Date.now(),
      });
      return true;
    },
    [offlineQueue, inspectionId, results, sectionIdForItem],
  );
}
