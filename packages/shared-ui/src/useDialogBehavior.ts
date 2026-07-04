import { useEffect } from "react";

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
): void {
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
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
    const initial = root?.querySelector<HTMLElement>(FOCUSABLE);
    (initial ?? root)?.focus();

    return () => {
      document.removeEventListener("keydown", handler);
      previouslyFocused?.focus?.();
    };
  }, [open, onClose, ref]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);
}
