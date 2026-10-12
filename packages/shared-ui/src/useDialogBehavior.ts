import { useEffect } from "react";
import { useLayer } from "./layers";

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
  const layer = useLayer(open, { onEscape: onClose, lockScroll: true });

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !layer.isTop()) return;
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
      // Hand focus back only when this was the dialog on top: a dialog underneath that
      // closes must not pull focus out of the one still open above it, and an element
      // that has since left the page cannot take it. useLayer's cleanup ran first (it is
      // declared first), so ask it, not the stack.
      if (layer.closedAsTop() && previouslyFocused?.isConnected) previouslyFocused.focus?.();
    };
    // Intentionally keyed on [open] only: onClose is read through the layer's ref and
    // ref identity is stable, so the trap/focus lifecycle runs on open-toggle only.
  }, [open]);
}
