/**
 * Clear a deleted inspection's locally cached field data off this device (F55).
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 *
 * Deleting an inspection runs a full server cascade — every inspection-scoped
 * row and every R2 object. Nothing touched the DEVICE. Each inspection a field
 * user opens leaves a `results-<id>` IndexedDB database behind (the y-indexeddb
 * mirror of its Yjs document, holding real CRDT update payloads) plus any photo
 * bytes still queued for upload. Those outlived the deletion indefinitely: a
 * walkthrough device was still holding the field content of two inspections the
 * server had already erased. `deleteResultsDb` existed for the restore-resync
 * path and had no caller outside its own module; the delete path called nothing.
 *
 * ── WHY IT WAITS FOR THE SERVER ─────────────────────────────────────────────
 *
 * The purge runs only after the delete action comes back `ok`, never alongside
 * the submit. Local-only content — an unsynced edit, a photo that has not
 * uploaded — exists nowhere else, so wiping it on a delete that then 403s would
 * be data loss caused by the cleanup.
 *
 * ⚠️ WHAT THIS DOES NOT REACH: every other device or browser profile that opened
 * the same inspection. There is no channel to them and no record of which ones
 * hold a copy. `app/lib/collab/offline-purge.ts` enumerates the limits.
 *
 * Batched rather than per id, because the page fires N deletes through ONE
 * fetcher and only the last response is observable — so a batch where one
 * delete failed purges all of them. Stated because it is a real edge, not an
 * oversight: the alternative (a fetcher per row) is a larger change to a page
 * this does not otherwise touch.
 */
import { useCallback, useEffect, useState } from "react";
import { purgeInspectionOfflineData } from "~/lib/collab/offline-purge";

/** The shape this hook reads off the page's delete fetcher. */
export interface DeleteFetcherLike {
    state: "idle" | "loading" | "submitting";
    data?: { intent?: string | null; ok?: boolean } | undefined;
}

export function useOfflinePurgeOnDelete(fetcher: DeleteFetcherLike): (ids: string[]) => void {
    const [queue, setQueue] = useState<string[]>([]);

    useEffect(() => {
        if (queue.length === 0 || fetcher.state !== "idle") return;
        if (fetcher.data?.intent !== "delete" || fetcher.data.ok !== true) return;
        const ids = queue;
        setQueue([]);
        // Fire and forget: the purge never rejects, and a cleanup must not be
        // able to block or fail the deletion the user already completed.
        void Promise.all(ids.map((id) => purgeInspectionOfflineData(id)));
    }, [fetcher.state, fetcher.data, queue]);

    return useCallback((ids: string[]) => {
        if (ids.length > 0) setQueue((prev) => [...prev, ...ids]);
    }, []);
}
