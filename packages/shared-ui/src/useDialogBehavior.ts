import { useEffect } from "react";
import { hasOpenLayer, useLayer } from "./layers";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

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

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      // Another dialog above this one owns the keyboard. A popover or menu above it does
      // not trap: focus may be inside it (even in a portal outside this dialog), and Tab
      // there is its own business, so this trap acts only on focus inside its own root.
      const covered = layer.coverage();
      if (covered === "dialog") return;
      const root = ref.current;
      if (!root) return;
      const nodes = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (nodes.length === 0) {
        e.preventDefault();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (!root.contains(active)) {
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

    const root = ref.current;
    // Prefer an explicit initial-focus target when it lives inside the dialog;
    // otherwise fall back to the first focusable (default behavior).
    const preferred = initialFocusRef?.current;
    const initial =
      preferred && root?.contains(preferred)
        ? preferred
        : root?.querySelector<HTMLElement>(FOCUSABLE);
    (initial ?? root)?.focus();

    return () => {
      document.removeEventListener("keydown", handler);
      // Hand focus back to the trigger. useLayer's cleanup ran first (it is declared
      // first), so ask it, not the stack. On top: restore now. Not on top: either a layer
      // above is still open and must keep focus, or it is closing in this same commit (React
      // runs parent cleanups first), in which case the trigger is ours to restore once the
      // commit has settled and nothing else holds focus. An element that has left the page
      // cannot take it.
      if (layer.closedAsTop()) {
        if (previouslyFocused?.isConnected) previouslyFocused.focus?.();
        return;
      }
      queueMicrotask(() => {
        if (hasOpenLayer() || !previouslyFocused?.isConnected) return;
        const active = document.activeElement;
        if (!active || active === document.body || !active.isConnected) previouslyFocused.focus?.();
      });
    };
    // Intentionally keyed on [open] only: onClose is read through the layer's ref and
    // ref identity is stable, so the trap/focus lifecycle runs on open-toggle only.
  }, [open]);
}
