import { useLayoutEffect, useRef } from "react";

/**
 * How long a result's actions ignore clicks after the result appears: the OS double-click interval.
 */
const RESULT_SETTLE_MS = 450;

/**
 * A guard for the buttons of a result that replaces a form in the same spot.
 *
 * A double click on "Send" can have its second click land after the answer has already arrived, on
 * whatever now sits where the button was: "Done" (which closes the dialog on a send the person never
 * got to read) or "Back". Returns a function that says whether the result has been on screen long
 * enough for a click on it to be deliberate; the actions ignore the click when it says no.
 *
 * It reads the clock when asked instead of holding a timer, so there is nothing to clean up and a
 * result that appears and goes within the interval leaves nothing behind.
 */
export function useSettledAfterShown(shown: boolean, ms = RESULT_SETTLE_MS): () => boolean {
  const since = useRef<number | null>(null);
  useLayoutEffect(() => {
    since.current = shown ? Date.now() : null;
  }, [shown]);
  return () => since.current !== null && Date.now() - since.current >= ms;
}
