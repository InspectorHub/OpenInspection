import { useCallback, useRef } from "react";

/**
 * The studio's cover toggle: show the new cover at once, and when the host refuses the save put back the LAST CONFIRMED
 * cover. Two quick presses are the reason: reverting to what the second press saw would restore a value that was never
 * saved. A refusal only undoes the value it set (a newer press, or a cover that moved with its re-baked photo, stands),
 * and a superseded save (`null`) says nothing and confirms nothing.
 */
export function useOptimisticCover<I extends Record<string, unknown>>(
  state: { inspection: I; setInspection: (update: (prev: I) => I) => void },
  setCover: (coverPhotoId: string, onResult: (ok: boolean | null) => void) => void,
): (photoKey: string) => void {
  const current = (state.inspection.coverPhotoId as string | null | undefined) ?? null;
  const shown = useRef<string | null>(current);
  shown.current = current;
  const confirmed = useRef<string | null>(current);
  const inFlight = useRef(0);
  // With nothing out, what the page holds is what the server holds.
  if (inFlight.current === 0) confirmed.current = current;
  const { setInspection } = state;

  return useCallback((photoKey: string) => {
    const next = shown.current === photoKey ? "" : photoKey;
    const value = next || null;
    shown.current = value; // a second press in the same frame sees this one
    inFlight.current += 1;
    setInspection((prev) => ({ ...prev, coverPhotoId: value }));
    setCover(next, (ok) => {
      inFlight.current -= 1;
      if (ok === null) return;
      if (ok) { confirmed.current = value; return; }
      setInspection((prev) => (prev.coverPhotoId === value ? { ...prev, coverPhotoId: confirmed.current } : prev));
    });
  }, [setInspection, setCover]);
}
