import React, { useEffect, useRef, useState } from "react";

interface PopoverProps {
  open: boolean;
  onClose: () => void;
  /** Trigger element the panel positions itself against. */
  anchorRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
  /** Horizontal alignment to the anchor's edge. Default 'right': the panel's right
   *  edge lines up with the anchor's right edge (standard dropdown placement). */
  align?: "left" | "right";
}

const PANEL_GAP_PX = 8;

/**
 * Anchored floating panel for lightweight in-context choices (column toggles,
 * dropdowns) — see docs/developers/11_design_system.md §4. NOT a Modal/Drawer:
 * no full-screen scrim, no body scroll-lock, no hard Tab focus-trap. The rest of
 * the page must stay visible and interactive while a Popover is open.
 *
 * This deliberately does NOT reuse useDialogBehavior. That hook's scroll-lock
 * and focus-trap are correct for Modal/Drawer but wrong here, and threading
 * boolean flags through it to opt a third, semantically different consumer out
 * of half its behavior would make it harder to reason about for its two real
 * callers. Esc-close + focus capture/restore are still shared *in spirit*
 * (same lifecycle shape), just reimplemented at popover scope: no scroll lock,
 * no trap, plus click-outside-to-close (which Modal/Drawer get for free from
 * their full-screen scrim, which this component doesn't have).
 */
export function Popover({ open, onClose, anchorRef, children, align = "right" }: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: "hidden" });

  // Stash onClose in a ref so the behavior effect below never depends on its
  // identity — same rationale as useDialogBehavior: a stray parent re-render
  // while the panel is open (e.g. unrelated state change) must not re-run
  // this effect and steal focus back from something the user is interacting
  // with inside the panel.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Position against the anchor's current viewport rect. Measuring
  // getBoundingClientRect is DOM-only, so this must stay inside an effect —
  // the component never touches layout during SSR.
  useEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const top = rect.bottom + PANEL_GAP_PX;
    setStyle(
      align === "left"
        ? { position: "fixed", top, left: rect.left }
        : { position: "fixed", top, right: window.innerWidth - rect.right },
    );
  }, [open, align, anchorRef]);

  // Esc-to-close, click-outside-to-close, focus capture on open / restore to
  // the anchor on close. Intentionally keyed on [open] only (see onCloseRef
  // above) so the lifecycle runs on open-toggle only, not on every render.
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    // mousedown (not click) so this fires before any click-through to the
    // newly-focused element outside the panel — the standard dropdown/menu
    // dismiss pattern.
    const handlePointerDown = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) onCloseRef.current();
    };
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handlePointerDown);

    panelRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handlePointerDown);
      anchorRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="false"
      style={style}
      className="z-50 bg-ih-bg-card border border-ih-border rounded-ih-card shadow-ih-popover"
    >
      {children}
    </div>
  );
}
