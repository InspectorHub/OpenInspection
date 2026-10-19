import { useEffect, useRef, useState } from "react";
import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";
import { purgeInspectionOfflineData } from "~/lib/collab/offline-purge";
import { MAX_DELETE_BATCH } from "~/lib/inspection-delete-limit";
import type { DeleteInspectionsResult } from "~/lib/inspection-delete.server";
import { m } from "~/paraglide/messages";

type Failure = { id: string; error: string };

/**
 * The inspection list's batch Delete: what the page does with a selection of
 * any size, and with the per-id answers.
 *
 * - The selection goes out in chunks of at most MAX_DELETE_BATCH, one request
 *   after another through ONE dedicated fetcher, and reads as a single batch:
 *   `busy` stays true for the whole run, the answers are merged, and the page
 *   re-reads once, after the last chunk. A request is one Worker invocation and
 *   each delete is a full cascade, so the server caps what one request may carry.
 * - Several submits at once on one fetcher cancel each other and only the last
 *   answer is seen, which is why chunks are sent in turn, never together. The
 *   fetcher is dedicated so a status change on the list cannot cancel a delete.
 * - Rows asked to go are hidden at once (`hiddenIds`); the router's re-read can
 *   still return them if it reads right after the write. Rows the server refused,
 *   or whose answer never arrived, come back and are reported in `failures`.
 *   Ids the loader no longer returns drop out of the set.
 * - `onSettled` receives the ids that are still there when the run ends.
 * - The device's cached copy is cleared only for inspections the server
 *   confirmed deleted, and only when the run ends on this page. KNOWN LIMIT: if
 *   the person leaves the page mid-run, chunks already sent still complete on the
 *   server but their offline data is not cleared (the hook is gone with the page).
 *   Local-only content exists nowhere else, so it is never wiped for a delete
 *   that did not happen.
 */
export function useBatchDelete(presentIds: ReadonlySet<string>, onSettled: (failedIds: Set<string>) => void) {
    // submit-guard-allow-no-busy: the control reads `busy` below, which covers the whole run, not one chunk.
    const { fetcher, submit } = useGuardedSubmit<DeleteInspectionsResult>();
    const [running, setRunning] = useState(false);
    const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(() => new Set());
    const [failures, setFailures] = useState<Failure[]>([]);
    const queue = useRef<string[][]>([]);
    const current = useRef<string[]>([]);
    const merged = useRef<{ deleted: string[]; failed: Failure[] }>({ deleted: [], failed: [] });
    const handled = useRef<unknown>(null);
    const sawBusy = useRef(false);

    const sendNext = (): boolean => {
        const chunk = queue.current.shift();
        if (!chunk) return false;
        current.current = chunk;
        sawBusy.current = false;
        const sent = submit({ intent: "delete-many", ids: chunk.join(","), ...(queue.current.length > 0 ? { more: "1" } : {}) }, { method: "post" });
        if (!sent) merged.current.failed.push(...chunk.map((id) => ({ id, error: m.inspections_hub_delete_error() })));
        return sent;
    };

    useEffect(() => {
        if (!running) return;
        if (fetcher.state !== "idle") { sawBusy.current = true; return; }
        const d = fetcher.data;
        // A request that answers at once may never be seen in flight, so a NEW answer is what counts;
        // idle with no new answer only means the request was lost if it was seen leaving.
        const fresh = d !== undefined && d !== handled.current;
        if (!fresh && !sawBusy.current) return;
        sawBusy.current = false;
        if (fresh) handled.current = d;
        if (d && fresh && d.intent === "delete-many") {
            merged.current.deleted.push(...d.deleted);
            merged.current.failed.push(...d.failed);
        } else {
            // Lost, or answered with something that is not a batch answer. Its rows are still there.
            merged.current.failed.push(...current.current.map((id) => ({ id, error: m.inspections_hub_delete_error() })));
        }
        while (queue.current.length > 0) { if (sendNext()) return; }
        const { deleted, failed } = merged.current;
        const failedIds = new Set(failed.map((f) => f.id));
        setHiddenIds((prev) => new Set([...prev].filter((id) => !failedIds.has(id))));
        setFailures(failed);
        setRunning(false);
        onSettled(failedIds);
        for (const id of deleted) void purgeInspectionOfflineData(id);
        // The page's setter and the guarded submit are stable enough; re-running on them would loop.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fetcher.state, fetcher.data, running]);

    // Ids the loader no longer returns need no hiding.
    useEffect(() => {
        if (running) return;
        setHiddenIds((prev) => {
            const next = [...prev].filter((id) => presentIds.has(id));
            return next.length === prev.size ? prev : new Set(next);
        });
    }, [presentIds, running]);

    const deleteMany = (ids: readonly string[]): boolean => {
        const unique = [...new Set(ids)];
        if (running || unique.length === 0) return false;
        queue.current = [];
        for (let i = 0; i < unique.length; i += MAX_DELETE_BATCH) queue.current.push(unique.slice(i, i + MAX_DELETE_BATCH));
        merged.current = { deleted: [], failed: [] };
        handled.current = fetcher.data;
        setRunning(true);
        setHiddenIds((prev) => new Set([...prev, ...unique]));
        setFailures([]);
        sendNext();
        return true;
    };

    return { deleteMany, busy: running, hiddenIds, failures, dismissFailures: () => setFailures([]) };
}
