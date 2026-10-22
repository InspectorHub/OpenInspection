import { useCallback, useEffect, useRef } from "react";

/**
 * Focus continuity for a confirmation opened from inside Compare.
 *
 * Compare unmounts in the same commit that opens the confirm dialog, so the dialog would record
 * <body> as the element to hand focus back to. Remember the row's Compare button instead and,
 * when the confirmation closes, focus it ONLY if focus has fallen to <body>: focus the user moved
 * elsewhere is never taken.
 */
export function useReturnFocusAfterCompare(confirmOpen: boolean) {
  const opener = useRef<HTMLElement | null>(null);
  const fromCompare = useRef(false);

  useEffect(() => {
    if (confirmOpen || !fromCompare.current) return;
    fromCompare.current = false;
    const active = document.activeElement;
    if (opener.current?.isConnected && (!active || active === document.body)) opener.current.focus();
  }, [confirmOpen]);

  /** Call from the Compare button's click. */
  const rememberOpener = useCallback((el: HTMLElement) => {
    opener.current = el;
  }, []);
  /** Call when the confirmation is opened from Compare (not from the row's own Restore). */
  const markFromCompare = useCallback(() => {
    fromCompare.current = true;
  }, []);

  return { rememberOpener, markFromCompare };
}
