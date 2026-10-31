import { useCallback, useRef } from "react";
import { useActionLatch } from "@core/shared-ui";

/**
 * `useActionLatch` that also stays shut while the promise the action returns is pending. The plain latch reopens one
 * task after the click, which an awaited check (reading a blob) can outlast, so a second click in a later task would
 * start a second check and a second write. A click while the first is pending is dropped; an action that returns
 * nothing behaves exactly as under `useActionLatch`. If the promise rejects the latch reopens and `onError` (if any)
 * is told, so the caller can say so instead of leaving a spinner running.
 */
export function useHeldLatch(busy: boolean, onError?: () => void): (action: () => void | Promise<unknown>) => void {
  const latch = useActionLatch(busy);
  const held = useRef(false);
  const failed = useRef(onError);
  failed.current = onError;
  return useCallback(
    (action) => latch(() => {
      if (held.current) return;
      const pending = action();
      if (!pending) return;
      held.current = true;
      const release = () => { held.current = false; };
      void pending.then(release, () => { release(); failed.current?.(); });
    }),
    [latch],
  );
}
