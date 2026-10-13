import { useLayoutEffect } from "react";

/**
 * A transparent layer that absorbs clicks for a moment after a dialog goes away.
 *
 * A confirm that closes on its first click leaves the second click of a double click landing on
 * whatever sits underneath the button: on the QuickBooks page that was "Save credentials", which
 * posted empty credentials. The layer covers the viewport for the OS double-click interval and then
 * removes itself; a person who really wants the control underneath loses well under half a second.
 *
 * It is raised from the cleanup of a layout effect, which covers both ways a dialog goes away: the
 * `open` prop flipping to false, and the component unmounting while open (the common
 * `{thing && <Dialog />}` shape, where nothing stays mounted to render a shield). A layout effect
 * cleanup runs in the same commit that removes the dialog, before the browser paints, so the layer is
 * already in place on the frame the dialog disappears. It lives on <body> because the dialog that
 * wanted it may have unmounted.
 *
 * Two guards keep it from getting in the way:
 *  - a dialog that was open for less than CLOSE_SHIELD_MIN_OPEN_MS was not closed by a person (a
 *    StrictMode remount, an instant swap) and leaves no layer;
 *  - any dialog opening removes a layer that is still up, and none is raised while another dialog is
 *    standing, so a confirm that hands over to a result dialog, or the lower dialog of a stack closing,
 *    does not leave a dialog's first click swallowed.
 *
 * It absorbs pointer clicks only. A dialog that closes by itself (a route change, an async success)
 * raises it too: the cost is that clicks in the next 450 ms are absorbed.
 */
export const CLOSE_SHIELD_MS = 450;
export const CLOSE_SHIELD_MIN_OPEN_MS = 150;

const SHIELD_ATTR = "data-click-shield";

function dropShield(): void {
  if (typeof document === "undefined") return;
  document.body.querySelectorAll(`[${SHIELD_ATTR}]`).forEach((el) => el.remove());
}

function raiseShield(ms: number): void {
  if (typeof document === "undefined") return;
  // Decided after the commit has settled (still before paint): another dialog standing means the page
  // is already covered by its backdrop, and a layer appended after that dialog would sit on top of it.
  if (document.querySelector('[role="dialog"], [aria-modal="true"]')) return;
  dropShield();
  const el = document.createElement("div");
  el.setAttribute(SHIELD_ATTR, "");
  el.setAttribute("aria-hidden", "true");
  el.className = "fixed inset-0 z-50";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

export function useCloseShield(open: boolean, ms = CLOSE_SHIELD_MS): void {
  useLayoutEffect(() => {
    if (!open) return;
    dropShield();
    const openedAt = Date.now();
    return () => {
      if (Date.now() - openedAt >= CLOSE_SHIELD_MIN_OPEN_MS) queueMicrotask(() => raiseShield(ms));
    };
  }, [open, ms]);
}
