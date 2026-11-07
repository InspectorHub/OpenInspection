import { useEffect, useState } from "react";

const NOT_TEXT_INPUT = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "file", "image", "color", "hidden"]);

/** The longest a bar stays hidden after the last text field was left, when the window never grows back (iOS covers the web view and does not resize it). */
const SETTLE_MS = 400;

/** A soft keyboard exists only on a touch device. With a mouse and a hardware keyboard nothing needs to get out of its way. */
function hasSoftKeyboard(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
}

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.tagName === "TEXTAREA") return true;
  if (target.tagName === "INPUT") return !NOT_TEXT_INPUT.has((target as HTMLInputElement).type);
  return target.isContentEditable;
}

/**
 * True while a text field has focus on a touch device, which on a phone is when the soft keyboard is up or coming up. Always false
 * with a mouse (`pointer: fine`): a desktop browser has no soft keyboard, and hiding a bar there only made it vanish while typing. The bars fixed to the bottom of
 * the screen (the item stepper and the Sections / Items / Preview tabs) hide for that time: where the keyboard resizes the window
 * a bar fixed to the bottom is laid out late and showed as a flicker, and on a short screen the bars took a third of the room.
 *
 * It stays true after the last field is left until the keyboard is gone, so the bars do not come back while the window is still
 * short (they showed up mid-screen and then slid down to the bottom): that is when the window has grown back (a resize, then two
 * frames for the layout), or after SETTLE_MS where the window is not resized.
 *
 * It follows `document.activeElement` rather than pairing focus and blur events: a field that is removed while it has focus fires no
 * blur, and moving from one field to another fires a blur between two focuses. The state is read again after every blur and every
 * press, so it cannot stay stuck on.
 */
export function useTextEntryActive(): boolean {
  const [active, setActive] = useState(() => typeof document !== "undefined" && hasSoftKeyboard() && isTextEntry(document.activeElement));
  useEffect(() => {
    if (!hasSoftKeyboard()) return undefined;
    let on = typeof document !== "undefined" && isTextEntry(document.activeElement);
    const put = (value: boolean) => {
      on = value;
      setActive(value);
    };
    let cancelSettle: (() => void) | null = null;
    const stopSettling = () => {
      cancelSettle?.();
      cancelSettle = null;
    };
    // No text field has focus any more: stay "active" until the keyboard is gone, then let go (unless a field took focus again).
    const settle = () => {
      stopSettling();
      const started = window.innerHeight;
      let frame = 0;
      const finish = () => {
        stopSettling();
        put(isTextEntry(document.activeElement));
      };
      const onResize = () => {
        if (window.innerHeight <= started) return;
        frame = requestAnimationFrame(() => {
          frame = requestAnimationFrame(finish);
        });
      };
      const timer = setTimeout(finish, SETTLE_MS);
      window.addEventListener("resize", onResize);
      cancelSettle = () => {
        clearTimeout(timer);
        cancelAnimationFrame(frame);
        window.removeEventListener("resize", onResize);
      };
    };
    const sync = () => {
      if (isTextEntry(document.activeElement)) {
        stopSettling();
        put(true);
      } else if (on && cancelSettle === null) {
        settle();
      }
    };
    const later = () => {
      setTimeout(sync, 0);
    };
    const onIn = () => {
      stopSettling();
      sync();
    };
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", later);
    document.addEventListener("pointerdown", later, true);
    if (isTextEntry(document.activeElement)) put(true);
    return () => {
      stopSettling();
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", later);
      document.removeEventListener("pointerdown", later, true);
    };
  }, []);
  return active;
}
