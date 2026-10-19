import { useEffect, useState } from "react";
import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";
import { purgeInspectionOfflineData } from "~/lib/collab/offline-purge";
import type { DeleteInspectionsResult } from "~/lib/inspection-delete.server";

/**
 * The inspection list's batch Delete: ONE request for the whole selection, and
 * what the page does with the per-id answer.
 *
 * One request, because several submits on one fetcher cancel each other and only
 * the last answer is ever seen. It has its own fetcher for the same reason: the
 * list's status changes must not cancel (or be mistaken for) a delete.
 *
 * - Rows asked to go are hidden at once (`hiddenIds`); the router's re-read can
 *   still return them if it reads right after the write.
 * - Rows the server refused come back and are reported in `failures` with the
 *   reason; `onSettled` receives their ids so the page can keep exactly those
 *   selected.
 * - The device's cached copy is cleared only for inspections the server
 *   confirmed deleted. Local-only content exists nowhere else, so it is never
 *   wiped for a delete that did not happen.
 */
export function useBatchDelete(onSettled: (failedIds: Set<string>) => void) {
    const { fetcher, submit, busy } = useGuardedSubmit<DeleteInspectionsResult>();
    const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(() => new Set());
    const [failures, setFailures] = useState<Array<{ id: string; error: string }>>([]);

    useEffect(() => {
        const d = fetcher.data;
        if (fetcher.state !== "idle" || d?.intent !== "delete-many") return;
        const failedIds = new Set(d.failed.map((f) => f.id));
        setHiddenIds((prev) => new Set([...prev].filter((id) => !failedIds.has(id))));
        setFailures(d.failed);
        onSettled(failedIds);
        for (const id of d.deleted) void purgeInspectionOfflineData(id);
        // onSettled is the page's setter; re-running on it would loop.
    }, [fetcher.state, fetcher.data]);

    const deleteMany = (ids: readonly string[]): boolean => {
        if (ids.length === 0) return false;
        if (!submit({ intent: "delete-many", ids: ids.join(",") }, { method: "post" })) return false;
        setHiddenIds((prev) => new Set([...prev, ...ids]));
        setFailures([]);
        return true;
    };

    return { deleteMany, busy, hiddenIds, failures, dismissFailures: () => setFailures([]) };
}
