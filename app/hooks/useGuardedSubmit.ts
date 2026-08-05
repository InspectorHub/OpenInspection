import { useCallback, useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

/**
 * A submit that cannot be fired twice, carrying an idempotency key whose
 * lifetime is: mint on mount, HOLD across a failure, ROTATE on success.
 *
 * Both directions matter. Rotating on failure would let the retry of a failed
 * submit read as a brand-new request server-side, which is the duplicate this
 * exists to stop. Never rotating is worse: the next thing the user deliberately
 * creates replays the first one's stored response, so they are told it worked
 * and nothing was written — a silent no-op is a worse outcome than the duplicate
 * it prevents.
 *
 * The in-flight guard is a ref rather than `fetcher.state`. `fetcher.submit()`
 * disables nothing and does not flip `state` before the handler returns, so both
 * halves of a double click run inside a single render and a `state` check sees
 * "idle" twice. (Measured: with a state-only guard, two clicks dispatched inside
 * one `act()` both reach the action.) `state` is still checked as the outer
 * bound — it covers a submit attempted from elsewhere while this one is in
 * flight.
 *
 * Pairs with the server-side idempotency middleware: the field below is what
 * the route action forwards as the `Idempotency-Key` header. Client code cannot
 * set headers on a `fetcher.submit`, which is why the key travels in the body.
 */

/** The form field the key travels in. */
export const IDEMPOTENCY_FIELD = "idempotencyKey";

function mintKey(): string {
    return crypto.randomUUID();
}

type SubmitOptions = Parameters<ReturnType<typeof useFetcher>["submit"]>[1];

/**
 * A settled result counts as a failure only when the action says so. A
 * successful create returns a redirect, which React Router follows without ever
 * populating `fetcher.data` — so "no data" is a success, not an unknown.
 */
function failed(data: unknown): boolean {
    return typeof data === "object" && data !== null && (data as { ok?: unknown }).ok === false;
}

export function useGuardedSubmit<T = unknown>() {
    const fetcher = useFetcher<T>();
    const [idempotencyKey, setIdempotencyKey] = useState<string>(mintKey);
    /** Set synchronously inside the handler — the only guard a double click meets. */
    const inFlight = useRef(false);

    const submit = useCallback(
        (payload: Record<string, string>, options: SubmitOptions): boolean => {
            if (inFlight.current || fetcher.state !== "idle") return false;
            inFlight.current = true;
            fetcher.submit({ ...payload, [IDEMPOTENCY_FIELD]: idempotencyKey }, options);
            return true;
        },
        [fetcher, idempotencyKey],
    );

    useEffect(() => {
        // Only a submit this hook started can settle it. Without the ref check
        // this would fire on mount and rotate a key nobody has used yet.
        if (fetcher.state !== "idle" || !inFlight.current) return;
        inFlight.current = false;
        if (!failed(fetcher.data)) setIdempotencyKey(mintKey());
    }, [fetcher.state, fetcher.data]);

    return { submit, fetcher, busy: fetcher.state !== "idle", idempotencyKey };
}
