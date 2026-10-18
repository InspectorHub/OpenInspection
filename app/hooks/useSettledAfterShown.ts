import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * How long a result's actions ignore clicks after the result appears: the OS double-click interval.
 */
const RESULT_SETTLE_MS = 450;

/**
 * A guard for the buttons of a result that replaces a form in the same spot.
 *
 * A double click on "Send" can have its second click land after the answer has already arrived, on
 * whatever now sits where the button was: "Done" (which closes the dialog on a send the person never
 * got to read) or "Back". `settled()` says whether the result has been on screen long enough for a
 * click on it to be deliberate; the actions ignore the click when it says no. It reads the clock when
 * asked, so the decision never depends on a render having happened.
 *
 * `waiting` is the same fact for rendering: true until the interval has passed, so the buttons can say
 * so to assistive technology (`aria-disabled`) instead of silently doing nothing. It flips on a timer
 * that is cleared with the result.
 */
export function useSettledAfterShown(shown: boolean, ms = RESULT_SETTLE_MS): { settled: () => boolean; waiting: boolean } {
  const since = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(false);
  useLayoutEffect(() => {
    since.current = shown ? Date.now() : null;
    setElapsed(false);
  }, [shown]);
  useEffect(() => {
    if (!shown) return;
    const timer = setTimeout(() => setElapsed(true), ms);
    return () => clearTimeout(timer);
  }, [shown, ms]);
  return {
    settled: () => since.current !== null && Date.now() - since.current >= ms,
    waiting: shown && !elapsed,
  };
}
