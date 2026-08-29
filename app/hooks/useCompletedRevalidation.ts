import { useEffect, useRef } from "react";

/**
 * Land a finished fieldwork submit: patch the status locally, then revalidate.
 *
 * -- WHY BOTH, AND WHY LOCALLY FIRST ----------------------------------------
 * The editor holds the inspection in its own state (see `useInspectionState`),
 * so revalidation alone leaves the header badge and the toolbar button stale.
 * The status is patched the same way a structural edit patches it, and the
 * revalidation then refreshes everything the loader derives.
 *
 * -- ⚠️ WHY THIS IS ONE-SHOT, AND WHY IT LEFT THE ROUTE ----------------------
 * `fetcher.data` keeps the SAME `{ ok: true }` reference until the next submit,
 * while `revalidator` and the editor state object are fresh every render. So an
 * unguarded effect re-fires on the render its own `setStatus` causes, and again
 * on the next, without end.
 *
 * Measured: 2.5 s after Finish fieldwork landed, ~90 `edit.data` revalidations
 * and as many prefs-fetcher reloads; the tab's renderer then stopped responding,
 * so the Publish modal could not stay mounted and an inspector could not publish
 * at all. A seeded inspection that had never been finished made 0 requests over
 * the same window, which is what named the trigger. After the guard: 6 requests
 * in 8 s, and the modal opens.
 *
 * The route already carries this hazard's twin for the units fetcher, with the
 * same one-shot shape and the same reasoning written beside it. Two copies of a
 * subtle rule in one 2,600-line file is how the second one comes to be written
 * without the guard, which is exactly what happened -- so this one lives here,
 * where a reader looking for it finds only it.
 */
export function useCompletedRevalidation(
    fetcherState: string,
    fetcherData: { ok: boolean } | undefined,
    onCompleted: () => void,
    revalidate: () => void,
): void {
    const lastHandled = useRef<unknown>(null);
    useEffect(() => {
        if (fetcherState !== "idle" || !fetcherData) return;
        if (!fetcherData.ok || lastHandled.current === fetcherData) return;
        lastHandled.current = fetcherData;
        onCompleted();
        revalidate();
        // `onCompleted` and `revalidate` are called, never compared: including
        // them would restore the very re-fire the ref exists to stop, because
        // both are new closures on every render of the caller.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fetcherState, fetcherData]);
}
