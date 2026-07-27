import { useState, useEffect, useRef, useCallback } from "react";
import { useFetcher } from "react-router";

/**
 * Pairs a modal's open-state with its own dedicated action fetcher (B-17: never
 * share fetchers between mutations). Derives the busy flag, the intent-matched
 * error, and (by default) closes the modal once the action succeeds. Pass
 * `closeOnSuccess: false` when the caller drives its own post-success effect
 * (e.g. the re-inspection flow navigates instead of closing).
 *
 * Lives outside the route so its reopen behaviour can be tested directly — the
 * bug below is invisible on the first pass through any flow and only shows up
 * on the second.
 */

/**
 * The slice this hook reads out of a route action's (much wider) result union.
 * `T` keeps the caller's full type on `fetcher` — only the derivations below
 * narrow to these three fields.
 */
interface IntentResult {
    intent?: string;
    ok?: boolean;
    error?: string;
}

export function useModalFetcher<T = unknown>(
    intent: string,
    opts?: { closeOnSuccess?: boolean },
) {
    const closeOnSuccess = opts?.closeOnSuccess ?? true;
    const [open, setOpenState] = useState(false);
    const fetcher = useFetcher<T>();
    const busy = fetcher.state !== "idle";

    // A fetcher keeps its last result forever, so a modal that closes on success
    // refuses to REOPEN: the open effect sees the old success and closes it again
    // on the same tick, and the button looks dead. Snapshot the result present at
    // open time and count only results that arrive after it.
    //
    // Sending an agreement twice is what surfaced this — adding a co-signer to a
    // live envelope means opening the same modal a second time, which the
    // single-recipient flow this replaced never had a reason to do.
    const consumedRef = useRef<unknown>(undefined);
    const setOpen = useCallback((next: boolean) => {
        if (next) consumedRef.current = fetcher.data;
        setOpenState(next);
    }, [fetcher]);

    const data = fetcher.data as IntentResult | undefined;
    const fresh = fetcher.data !== consumedRef.current;
    const succeeded = fresh && fetcher.state === "idle" && data?.intent === intent && data.ok === true;
    const error = fresh && data?.intent === intent && data.ok === false ? data.error : undefined;

    useEffect(() => {
        if (closeOnSuccess && open && succeeded) setOpenState(false);
    }, [closeOnSuccess, open, succeeded]);

    return { open, setOpen, fetcher, busy, error, succeeded };
}
