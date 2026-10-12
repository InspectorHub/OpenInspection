import { useCallback, useEffect, useRef } from "react";

/**
 * Lets an action through once per press, even when the caller has not re-rendered `busy`
 * yet. A second synchronous call is dropped. The latch opens again when `busy` goes
 * true -> false, or one macrotask later, so a caller that never raises `busy` (a handler that
 * returns early, an async handler that was declined before it submitted, a purely synchronous
 * one) is not left dead after its first use. Callers that flip `busy` in the same event are
 * unaffected: their pending button is already inert by the time a person can click again.
 */
export function useActionLatch(busy: boolean): (action: () => void) => void {
  const latched = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wasBusy = useRef(busy);

  const release = useCallback(() => {
    latched.current = false;
    clearTimeout(timer.current);
  }, []);

  useEffect(() => {
    if (wasBusy.current && !busy) release();
    wasBusy.current = busy;
  }, [busy, release]);

  useEffect(() => release, [release]);

  return useCallback(
    (action) => {
      if (latched.current) return;
      latched.current = true;
      timer.current = setTimeout(release, 0);
      action();
    },
    [release],
  );
}
