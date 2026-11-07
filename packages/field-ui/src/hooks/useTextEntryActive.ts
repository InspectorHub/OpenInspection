import { useEffect, useState } from "react";

const NOT_TEXT_INPUT = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "file", "image", "color", "hidden"]);

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.tagName === "TEXTAREA") return true;
  if (target.tagName === "INPUT") return !NOT_TEXT_INPUT.has((target as HTMLInputElement).type);
  return target.isContentEditable;
}

/**
 * True while a text field has focus, which on a phone is when the soft keyboard is up or coming up. The bars fixed to the bottom of
 * the screen (the item stepper and the Sections / Items / Preview tabs) hide for that time: the keyboard shrinks the web view, and
 * on iOS a bar fixed to the bottom is laid out one frame late, so for a moment it sits below the visible area and then jumps in above
 * the keyboard. Hidden, they cannot flicker, and a short screen keeps the room they took.
 *
 * It follows `document.activeElement` rather than pairing focus and blur events: a field that is removed while it has focus fires no
 * blur, and moving from one field to another fires a blur between two focuses. The state is read again after every blur and every
 * press, so it cannot stay stuck on.
 */
export function useTextEntryActive(): boolean {
  const [active, setActive] = useState(() => typeof document !== "undefined" && isTextEntry(document.activeElement));
  useEffect(() => {
    const sync = () => setActive(isTextEntry(document.activeElement));
    const later = () => {
      setTimeout(sync, 0);
    };
    document.addEventListener("focusin", sync);
    document.addEventListener("focusout", later);
    document.addEventListener("pointerdown", later, true);
    sync();
    return () => {
      document.removeEventListener("focusin", sync);
      document.removeEventListener("focusout", later);
      document.removeEventListener("pointerdown", later, true);
    };
  }, []);
  return active;
}
