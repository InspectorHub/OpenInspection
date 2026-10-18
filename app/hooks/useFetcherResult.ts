import { useEffect, useRef } from "react";

/**
 * The fetcher's data, but only a result that arrived after this component mounted. A fetcher owned by the page keeps
 * its last result after a dialog closes, so reading `fetcher.data` straight on the next open shows the previous send's
 * answer (its error, say) on a form that has not sent anything yet.
 */
export function useResultSinceMount<T>(data: T | undefined): T | undefined {
    const atMount = useRef(data);
    return data !== undefined && data !== atMount.current ? data : undefined;
}

/**
 * Runs `handler` once for each NEW result a fetcher delivers, as soon as the action has answered.
 *
 * That is not waiting for `idle`: after an action the router revalidates the page's loaders and the fetcher
 * stays in `loading` until they finish. A slow or failing revalidation would otherwise leave a drawer open
 * after a save that already succeeded, inviting a second submit. Only `submitting` holds the handler back, and
 * because a result is acted on once, the later `idle` does not repeat it.
 *
 * A fetcher keeps its last result after the component that read it closes, and a parent usually hands
 * `onClose` down as an inline arrow, so an effect keyed on `[fetcher.data, onClose]` re-runs on every
 * render and sees the old result again. For a drawer that stays mounted that closes it the instant it
 * reopens; for a modal remounted over a fetcher owned by its parent it closes it on mount.
 *
 * Here the result already present when the component mounts counts as handled, so only a submission made
 * while it is mounted can act, and the handler is read through a ref so its identity never re-triggers it.
 */
export function useFetcherResult<T>(
    fetcher: { state: string; data: T | undefined },
    handler: (data: T) => void,
): void {
    const { state, data } = fetcher;
    const handled = useRef<T | undefined>(data);
    const latest = useRef(handler);
    useEffect(() => {
        latest.current = handler;
    });
    useEffect(() => {
        if (state === "submitting" || data === undefined || data === handled.current) return;
        handled.current = data;
        latest.current(data);
    }, [state, data]);
}
