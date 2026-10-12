import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLayer } from "./layers";

/**
 * Measurement must happen before the browser paints, or the panel is visible
 * for one frame at whatever coordinates it last held. `useLayoutEffect` warns
 * when it runs during SSR, and this component's hooks do run there (the
 * `open` early-return is below them), so fall back to `useEffect` on the
 * server — where there is no layout to measure anyway.
 */
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

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
 * dropdowns) — see docs/develop/design-system.md §4. NOT a Modal/Drawer:
 * no full-screen scrim, no body scroll-lock, no hard Tab focus-trap. The rest of
 * the page must stay visible and interactive while a Popover is open.
 *
 * This deliberately does NOT reuse useDialogBehavior: its scroll-lock and focus-trap
 * are right for Modal/Drawer but wrong here. It does join the shared layer stack
 * (layers.ts), so Escape closes the popover and NOT a modal underneath it; the next
 * Escape then reaches the modal. No scroll lock, no trap; plus click-outside-to-close
 * (which Modal/Drawer get for free from their full-screen scrim, which this
 * component doesn't have).
 */
export function Popover({ open, onClose, anchorRef, children, align = "right" }: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  /**
   * `position: fixed` from the very first render, before anything is measured.
   *
   * This is not a detail. A popover is typically rendered as a SIBLING of its
   * trigger, so a first render without `position` puts the panel in normal flow
   * — and inside the flex row that most triggers live in, that pushes the
   * trigger sideways by the panel's own width. The positioning effect then
   * measures the anchor in its displaced state and pins the panel there, where
   * it stays: adrift in the middle of the page, nowhere near the control that
   * opened it. Reopening looked fine, which is what made it confusing — by then
   * the style already carried `position: fixed`, so nothing was displaced.
   *
   * `visibility: hidden` covers the same first frame: fixed at 0,0 is out of
   * flow but would flash in the corner before the effect runs.
   */
  const [style, setStyle] = useState<React.CSSProperties>({
    position: "fixed",
    top: 0,
    left: 0,
    visibility: "hidden",
  });

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
  //
  // The panel is `position: fixed`, so its coordinates are viewport
  // coordinates and stop tracking the anchor the moment anything moves. Two
  // things move it: the page scrolling under a trigger that lives in normal
  // flow (a page header, a table toolbar), and the window resizing. Both are
  // listened for while open — without them the panel detaches and floats over
  // unrelated content, which is what a first-open with a stale rect looked
  // like: a menu adrift in the middle of the page with no visible owner.
  const reposition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const panelWidth = panelRef.current?.offsetWidth ?? 0;
    const top = rect.bottom + PANEL_GAP_PX;
    if (align === "left") {
      // Clamp so a panel anchored near the right edge cannot run off-screen.
      const maxLeft = Math.max(PANEL_GAP_PX, window.innerWidth - panelWidth - PANEL_GAP_PX);
      setStyle({ position: "fixed", top, left: Math.min(rect.left, maxLeft) });
    } else {
      const maxRight = Math.max(PANEL_GAP_PX, window.innerWidth - panelWidth - PANEL_GAP_PX);
      setStyle({ position: "fixed", top, right: Math.min(window.innerWidth - rect.right, maxRight) });
    }
  }, [align, anchorRef]);

  useIsomorphicLayoutEffect(() => {
    if (!open) return;
    reposition();
    // `capture: true` so a scroll inside any ancestor container counts, not
    // only a scroll of the document itself.
    const onScroll = () => reposition();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, reposition]);

  useLayer(open, { onEscape: onClose });

  // Click-outside-to-close, focus capture on open / restore to
  // the anchor on close. Intentionally keyed on [open] only (see onCloseRef
  // above) so the lifecycle runs on open-toggle only, not on every render.
  useEffect(() => {
    if (!open) return;

    // mousedown (not click) so this fires before any click-through to the
    // newly-focused element outside the panel — the standard dropdown/menu
    // dismiss pattern.
    const handlePointerDown = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) onCloseRef.current();
    };
    document.addEventListener("mousedown", handlePointerDown);

    panelRef.current?.focus();

    return () => {
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
      /* border-STRONG, not border: a popover is frequently anchored to a
         control that already sits on a card (the sidebar, a toolbar), and
         `--ih-bg-card` on `--ih-bg-card` with a hairline border reads as one
         continuous surface — the panel's edge disappears exactly where it
         matters most. The strong token is the same hue one step up, so this
         separates without turning into a frame. */
      className="z-50 bg-ih-bg-card border border-ih-border-strong rounded-ih-card shadow-ih-popover"
    >
      {children}
    </div>
  );
}
