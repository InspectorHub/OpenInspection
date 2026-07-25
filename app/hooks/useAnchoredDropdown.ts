import { useEffect, useRef, useState } from "react";
import { anchoredDropdownPlacement, type DropdownPlacement } from "~/lib/dropdown-position";

/**
 * Keeps a portaled dropdown glued to the field that opened it.
 *
 * A list rendered `absolute` inside a panel that scrolls its own body is clipped
 * by that panel (see `app/lib/dropdown-position.ts`). The fix is a portal to
 * <body> with `position: fixed`, which costs the list its automatic position —
 * so it gets measured here instead, and re-measured whenever anything moves it.
 *
 * `style` is null until the first measurement, which is what keeps SSR from
 * touching the DOM: the server renders no portal at all, and the client mounts
 * one on the effect that follows hydration.
 */
export function useAnchoredDropdown<T extends HTMLElement = HTMLInputElement>(open: boolean) {
    const anchorRef = useRef<T | null>(null);
    const [placement, setPlacement] = useState<DropdownPlacement | null>(null);

    useEffect(() => {
        if (!open) {
            setPlacement(null);
            return;
        }
        const measure = () => {
            const el = anchorRef.current;
            if (!el) return;
            const r = el.getBoundingClientRect();
            setPlacement(
                anchoredDropdownPlacement(
                    { top: r.top, bottom: r.bottom, left: r.left, width: r.width },
                    window.innerHeight,
                    { viewportWidth: window.innerWidth },
                ),
            );
        };
        measure();
        // capture: true — the field usually sits in a panel with its own scroll
        // box, and that box's scroll events never reach window in the bubble
        // phase. Without capture the list detaches from the field on exactly the
        // scroll that was supposed to bring it into view.
        window.addEventListener("scroll", measure, true);
        window.addEventListener("resize", measure);
        return () => {
            window.removeEventListener("scroll", measure, true);
            window.removeEventListener("resize", measure);
        };
    }, [open]);

    const style: React.CSSProperties | null = placement
        ? {
              position: "fixed",
              top: placement.top,
              left: placement.left,
              width: placement.width,
              maxHeight: placement.maxHeight,
          }
        : null;

    return { anchorRef, placement, style };
}
