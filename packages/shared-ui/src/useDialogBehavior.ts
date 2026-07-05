import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Shared dialog chrome behavior for Modal and Drawer:
 * Escape-to-close, Tab focus trap, body scroll lock, focus capture on
 * open and focus restore on close. Keep this the ONLY implementation —
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
  // Stash onClose in a ref so the focus effect never depends on its identity.
  // Real callers pass an inline arrow fn, whose identity changes on every parent
  // re-render; if the focus effect re-ran on those renders it would restore focus
  // to the trigger and then steal it to the first focusable, dropping the caret
  // out of a field the user is typing in. The effect must run on open-toggle only.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
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
      previouslyFocused?.focus?.();
    };
    // Intentionally keyed on [open] only: onClose is read through onCloseRef and
    // ref identity is stable, so the trap/focus lifecycle runs on open-toggle only.
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);
}
