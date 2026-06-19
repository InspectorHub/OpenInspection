import { useState, useEffect } from "react";

/**
 * Transient success-flash state. Whenever `dep` changes, the hook re-evaluates:
 * if `active` is true (a successful save round-trip) the flash shows and auto-
 * dismisses after `durationMs` (default 4s). Errors are NOT handled here —
 * callers keep those visible until the next attempt (no auto-dismiss).
 *
 * `dep` mirrors the dependency the inline copies keyed their effect on (the
 * route's `actionData`), so two consecutive successful saves each re-arm the
 * timer exactly as before. Returns `{ flashVisible, setFlashVisible }` so
 * callers can also dismiss it imperatively.
 */
export function useFlash(
  active: boolean,
  dep: unknown,
  durationMs = 4000,
): { flashVisible: boolean; setFlashVisible: (v: boolean) => void } {
  const [flashVisible, setFlashVisible] = useState(false);
  useEffect(() => {
    if (active) {
      setFlashVisible(true);
      const t = setTimeout(() => setFlashVisible(false), durationMs);
      return () => clearTimeout(t);
    }
  }, [dep]);
  return { flashVisible, setFlashVisible };
}
