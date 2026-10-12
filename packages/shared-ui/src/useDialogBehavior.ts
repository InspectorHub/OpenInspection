import { useEffect, useRef } from "react";
import { hasTrappingLayer, useLayer } from "./layers";

// Hidden inputs and anything disabled are filtered again in focusableIn; the selector
// states only what it can cheaply.
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable]:not([contenteditable="false"]), summary, iframe, audio[controls], video[controls]';

/**
 * True when `el` is rendered and visible. Prefers the platform's checkVisibility; without
 * it, walks computed style (display:none on any ancestor, visibility on the node). Never
 * falls back to getClientRects: it is always empty where there is no layout engine
 * (jsdom, happy-dom), which would call every node invisible.
 */
function isRendered(el: HTMLElement): boolean {
  if (typeof el.checkVisibility === "function") {
    return el.checkVisibility({ visibilityProperty: true });
  }
  for (let n: HTMLElement | null = el; n; n = n.parentElement) {
    if (getComputedStyle(n).display === "none") return false;
  }
  const v = getComputedStyle(el).visibility;
  return v !== "hidden" && v !== "collapse";
}

/** Focusable descendants of `root` that can actually take focus right now. */
function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.matches(":disabled") && !el.closest("[hidden], [inert]") && isRendered(el),
  );
}

/** True when `el` can take focus back: attached, enabled (fieldset included), not inert, rendered. */
function canRestoreTo(el: HTMLElement | null): el is HTMLElement {
  return (
    !!el &&
    el.isConnected &&
    !el.matches(":disabled") &&
    el.getAttribute("aria-disabled") !== "true" &&
    !el.closest("[inert]") &&
    isRendered(el)
  );
}

/** Focuses `el` and reports whether it took focus (focus() silently no-ops on some nodes). */
function focusEl(el: HTMLElement, opts?: FocusOptions): boolean {
  el.focus?.(opts);
  return document.activeElement === el;
}

/** <main> as the last resort; a tabindex this code added is removed again on blur. */
function focusMain(): void {
  const main = document.querySelector<HTMLElement>("main");
  if (!main) return;
  const added = !main.hasAttribute("tabindex");
  if (added) {
    main.setAttribute("tabindex", "-1");
    main.addEventListener("blur", () => main.removeAttribute("tabindex"), { once: true });
  }
  if (!focusEl(main, { preventScroll: true }) && added) main.removeAttribute("tabindex");
}

/**
 * Focus goes back to the trigger when it can take it; otherwise to the page's declared
 * fallback ([data-focus-fallback]), then <main>; otherwise focus is left alone. Each step
 * is verified: a focus() that did not land falls through to the next link.
 */
function restoreFocus(trigger: HTMLElement | null): void {
  if (canRestoreTo(trigger) && focusEl(trigger)) return;
  const fallback = document.querySelector<HTMLElement>("[data-focus-fallback]");
  if (canRestoreTo(fallback) && focusEl(fallback, { preventScroll: true })) return;
  focusMain();
}

/**
 * Shared dialog chrome behavior for Modal and Drawer:
 * Escape-to-close, Tab focus trap, body scroll lock, focus capture on
 * open and focus restore on close. Escape and the scroll lock come from the shared
 * layer stack (see layers.ts), so only the topmost overlay answers and the lock is
 * counted across every overlay, not just dialogs. Keep this the ONLY implementation —
 * feature code must never hand-roll these.
 */
export function useDialogBehavior(
  open: boolean,
  onClose: () => void,
  ref: React.RefObject<HTMLElement | null>,
  /**
   * Optional element to receive initial focus on open. When provided and the
   * element is inside the dialog, it wins over the first-focusable default
   * (used by input-first dialogs so the caret lands in the field, not on the
   * header close button). Read through `.current` inside the effect so a ref —
   * which is stable — never enters the dep array; the effect stays keyed on
   * [open] only, preserving the focus-stability invariant below.
   */
  initialFocusRef?: React.RefObject<HTMLElement | null>,
): void {
  // useLayer stashes onClose in a ref, so the effect below never depends on its identity.
  // Real callers pass an inline arrow fn whose identity changes on every parent re-render;
  // re-running the focus effect on those would restore focus to the trigger and then steal
  // it to the first focusable, dropping the caret out of a field the user is typing in.
  const layer = useLayer(open, { onEscape: onClose, lockScroll: true, traps: true });

  // The opener is read while rendering the first open render: by the time effects run, a
  // child autoFocus or mount effect has already moved focus into the dialog (child effects
  // run before the parent's). undefined = not captured yet; null = nothing to return to.
  const opener = useRef<HTMLElement | null | undefined>(undefined);
  if (!open) opener.current = undefined;
  else if (opener.current === undefined) {
    const active = typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null);
    opener.current = active && active !== document.body ? active : null;
  }

  useEffect(() => {
    if (!open) return;
    const root = ref.current;
    // An element inside the dialog is never the opener.
    let trigger = opener.current ?? null;
    if (trigger && root?.contains(trigger)) trigger = null;
    // Engine-specific: a menu that opens this dialog hands focus to its own anchor in a
    // cleanup of the SAME commit, after the render-time read. When the render-time opener
    // is missing or already gone (the menu item that was clicked), take the live focus,
    // still excluding anything inside the dialog.
    if (!trigger || !trigger.isConnected) {
      const live = document.activeElement as HTMLElement | null;
      trigger = live && live !== document.body && !root?.contains(live) ? live : null;
    }

    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      // Another dialog above this one owns the keyboard. A popover or menu above it does
      // not trap: focus may be inside it (even in a portal outside this dialog), and Tab
      // there is its own business, so this trap acts only on focus inside its own root.
      const covered = layer.coverage();
      if (covered === "dialog") return;
      const liveRoot = ref.current;
      if (!liveRoot) return;
      const nodes = focusableIn(liveRoot);
      if (nodes.length === 0) {
        e.preventDefault();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (!liveRoot.contains(active)) {
        if (covered === "overlay") return;
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handler);

    // Prefer an explicit initial-focus target when it lives inside the dialog;
    // otherwise fall back to the first focusable (default behavior).
    const preferred = initialFocusRef?.current;
    const initial =
      preferred && root?.contains(preferred) ? preferred : root ? focusableIn(root)[0] : undefined;
    (initial ?? root)?.focus();

    // Focus may be restored only while nobody deliberately moved it: on body/null, on a
    // detached node, or inside this dialog's own (possibly already detached) root.
    const focusIsFree = () => {
      const now = document.activeElement;
      return !now || now === document.body || !now.isConnected || !!root?.contains(now);
    };

    return () => {
      document.removeEventListener("keydown", handler);
      // Hand focus back to the trigger. useLayer's cleanup ran first (it is declared
      // first), so ask it, not the stack. On top: restore now. Not on top: a layer above is
      // still open and keeps focus, or it closes in this same commit (React runs parent
      // cleanups first), in which case restore once the commit has settled and nothing else
      // holds focus. A trigger that cannot take focus also waits for the settled commit: a
      // fallback focused now would hide the outer dialog's real trigger from the dialog
      // closing beneath this one.
      if (layer.closedAsTop() && canRestoreTo(trigger)) {
        if (!focusIsFree()) return;
        if (focusEl(trigger)) return;
      }
      queueMicrotask(() => {
        // Only a dialog above cancels the restore; a popover does not own focus.
        if (hasTrappingLayer()) return;
        if (focusIsFree()) restoreFocus(trigger);
      });
    };
    // Intentionally keyed on [open] only: onClose is read through the layer's ref and
    // ref identity is stable, so the trap/focus lifecycle runs on open-toggle only.
  }, [open]);
}
