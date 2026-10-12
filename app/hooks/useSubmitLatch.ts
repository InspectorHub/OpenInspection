import { useCallback, useEffect, useRef } from "react";
import type { FormEvent } from "react";
import { useNavigation } from "react-router";

/**
 * Closes the same-frame window on a plain React Router `<Form>`.
 *
 * `navigation.state` only flips to "submitting" after React renders, so two
 * clicks dispatched in one frame both reach the submit handler while the state
 * still reads "idle" and the page's `pending` button is not yet inert. The latch
 * is a ref set synchronously inside the handler and released when the
 * navigation returns to idle.
 *
 * Wrap whatever `onSubmit` the form already has (conform's `form.onSubmit`, for
 * instance): the wrapped handler runs first, and the latch only closes when it
 * left the submit alive. A submit conform rejected with `preventDefault()` never
 * latches, so fixing a validation error and resubmitting is not blocked.
 */
/**
 * A form posted through a fetcher never moves `navigation.state`, so it passes that fetcher's
 * `state` and the latch follows it instead.
 */
export function useSubmitLatch(fetcherState?: string) {
    const navigation = useNavigation();
    const latched = useRef(false);
    const sawBusy = useRef(false);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const state = fetcherState ?? navigation.state;

    useEffect(() => {
        if (state === "idle") {
            latched.current = false;
            sawBusy.current = false;
            clearTimeout(timer.current);
        } else {
            sawBusy.current = true;
        }
    }, [state]);

    useEffect(() => () => clearTimeout(timer.current), []);

    // The latch also opens one macrotask after it closes when the state was never seen non-idle: an
    // idle -> submitting -> idle round trip that React batched into one render would otherwise leave
    // it closed for good. Two submits in one task are still blocked.
    return useCallback(
        <E extends FormEvent<HTMLFormElement>>(next?: (event: E) => void) =>
            (event: E): void => {
                if (latched.current) {
                    event.preventDefault();
                    return;
                }
                next?.(event);
                if (event.defaultPrevented) return;
                latched.current = true;
                sawBusy.current = false;
                clearTimeout(timer.current);
                timer.current = setTimeout(() => {
                    if (!sawBusy.current) latched.current = false;
                }, 0);
            },
        [],
    );
}
