import { useEffect, useRef } from "react";

/**
 * Runs `handler` once for each NEW result a fetcher delivers, after it has settled to idle.
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
        if (state !== "idle" || data === undefined || data === handled.current) return;
        handled.current = data;
        latest.current(data);
    }, [state, data]);
}
