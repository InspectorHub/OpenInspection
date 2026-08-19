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
 * The guarded submit, as a standalone type.
 *
 * Exported because a presentational component can be handed the submit without
 * owning the fetcher — `PaymentsModal` is rendered by `/invoices`, which owns
 * the fetcher whose `data` drives the page's banner. Passing the guarded
 * function down keeps the raw `fetcher.submit` out of the leaf while leaving
 * one guard, one key, and one in-flight window for the whole surface. Returns
 * `false` when the guard refused the call.
 */
export type GuardedSubmit = (payload: Record<string, string>, options: SubmitOptions) => boolean;

/**
 * A settled result counts as a failure only when the action says so. A
 * successful create returns a redirect, which React Router follows without ever
 * populating `fetcher.data` — so "no data" is a success, not an unknown.
 */
function failed(data: unknown): boolean {
    return typeof data === "object" && data !== null && (data as { ok?: unknown }).ok === false;
}

/**
 * Forwarded verbatim to `useFetcher`.
 *
 * `key` is not a nicety: several settings surfaces render one widget per row
 * and give each fetcher a stable key so its pending state survives a remount
 * and does not collide with its siblings'. A conversion that dropped the key
 * would silently merge those rows' fetchers, which is a behaviour change
 * wearing the shape of a refactor.
 */
type GuardedSubmitOptions = Parameters<typeof useFetcher>[0];

export function useGuardedSubmit<T = unknown>(options?: GuardedSubmitOptions) {
    const fetcher = useFetcher<T>(options);
    const [idempotencyKey, setIdempotencyKey] = useState<string>(mintKey);
    /** Set synchronously inside the handler — the only guard a double click meets. */
    const inFlight = useRef(false);
    /**
     * The key a submit actually sends, updated SYNCHRONOUSLY when it rotates.
     *
     * Reading the state variable here left a window. The settle effect released
     * `inFlight` and queued `setIdempotencyKey`; until React committed that
     * render, `submit` still closed over the OLD key while both guards were
     * open. A click landing in that window sent a duplicate request bearing the
     * spent key, which the server treats as a replay of the first — the caller
     * is told it worked and nothing is written, the exact failure the docblock
     * above calls the worse of the two.
     *
     * The state variable stays, because the rendered value is what tests and any
     * UI read; the ref is what the request carries.
     */
    const keyRef = useRef(idempotencyKey);

    const submit = useCallback(
        (payload: Record<string, string>, options: SubmitOptions): boolean => {
            if (inFlight.current || fetcher.state !== "idle") return false;
            inFlight.current = true;
            fetcher.submit({ ...payload, [IDEMPOTENCY_FIELD]: keyRef.current }, options);
            return true;
        },
        [fetcher],
    );

    useEffect(() => {
        // Only a submit this hook started can settle it. Without the ref check
        // this would fire on mount and rotate a key nobody has used yet.
        if (fetcher.state !== "idle" || !inFlight.current) return;
        // Rotate BEFORE releasing the guard, and into the ref first. Releasing
        // first reopens `submit` while `keyRef` still holds the spent key.
        if (!failed(fetcher.data)) {
            const next = mintKey();
            keyRef.current = next;
            setIdempotencyKey(next);
        }
        inFlight.current = false;
    }, [fetcher.state, fetcher.data]);

    return { submit, fetcher, busy: fetcher.state !== "idle", idempotencyKey };
}
