import React, { useEffect, useState } from "react";

/**
 * True for a short while after `open` goes from true to false.
 *
 * A confirm that closes on its first click leaves the second click of a double click landing on
 * whatever sits underneath the button: on the QuickBooks page that was "Save credentials", which posted
 * empty credentials. While this is true the dialog renders a transparent <ClickShield /> where it
 * was, so that click is absorbed instead of reaching the page. The window is the OS double-click
 * interval; a person who really wants the control underneath loses well under half a second.
 *
 * The shield state is derived during the render that sees `open` change (React's documented
 * pattern for state that follows a prop), so it is already in place on the frame the dialog closes.
 */
export const CLOSE_SHIELD_MS = 450;

export function useCloseShield(open: boolean, ms = CLOSE_SHIELD_MS): boolean {
  const [wasOpen, setWasOpen] = useState(open);
  const [shieldUntil, setShieldUntil] = useState(0);
  const [, tick] = useState(0);

  if (wasOpen !== open) {
    setWasOpen(open);
    setShieldUntil(open ? 0 : Date.now() + ms);
  }

  useEffect(() => {
    if (open || shieldUntil === 0) return;
    const left = shieldUntil - Date.now();
    if (left <= 0) return;
    const timer = setTimeout(() => tick((n) => n + 1), left);
    return () => clearTimeout(timer);
  }, [open, shieldUntil]);

  return !open && shieldUntil > Date.now();
}

/** Same stacking layer as the dialog's own backdrop, invisible, and out of the accessibility tree. */
export function ClickShield() {
  return <div aria-hidden="true" data-click-shield="" className="fixed inset-0 z-50" />;
}
