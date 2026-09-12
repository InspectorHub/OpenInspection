import { useEffect, useRef, useState } from "react";
import { anchoredDropdownPlacement, type DropdownPlacement } from "~/lib/dropdown-position";

/**
 * How the hook finds the thing the list must not cover (F41).
 *
 * A selector rather than a ref: the obstacle is usually a wizard's navigation
 * footer, which lives several components away from the field, and threading a
 * ref through every step component would put the plumbing in three files that
 * have no other reason to know about it. The search walks UP from the anchor and
 * takes the first ancestor that contains a match, so two wizards on one page
 * (a settings preview beside a live form) each find their own footer instead of
 * whichever one the document happens to reach first.
 */
function findObstacle(anchor: Element, selector: string): Element | null {
    let node: Element | null = anchor;
    while (node) {
        const hit = node.querySelector(selector);
        if (hit) return hit;
        node = node.parentElement;
    }
    return null;
}

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
export function useAnchoredDropdown<T extends HTMLElement = HTMLInputElement>(
    open: boolean,
    opts?: {
        /**
         * CSS selector for an element the list must not cover — typically the
         * form's primary action. Escaping the clip box stopped the list being
         * truncated and let it land ON the button instead (F41), which a
         * viewport-only measurement cannot see.
         */
        obstacleSelector?: string;
    },
) {
    const anchorRef = useRef<T | null>(null);
    const [placement, setPlacement] = useState<DropdownPlacement | null>(null);
    const obstacleSelector = opts?.obstacleSelector;

    useEffect(() => {
        if (!open) {
            setPlacement(null);
            return;
        }
        const measure = () => {
            const el = anchorRef.current;
            if (!el) return;
            const r = el.getBoundingClientRect();
            const obstacleEl = obstacleSelector ? findObstacle(el, obstacleSelector) : null;
            const obstacleRect = obstacleEl?.getBoundingClientRect();
            setPlacement(
                anchoredDropdownPlacement(
                    { top: r.top, bottom: r.bottom, left: r.left, width: r.width },
                    window.innerHeight,
                    {
                        viewportWidth: window.innerWidth,
                        // A zero-height rect is an element that is not laid out
                        // (display:none, or not yet measured); treating its top
                        // as a ceiling would collapse the list for no reason.
                        obstacle: obstacleRect && obstacleRect.height > 0
                            ? { top: obstacleRect.top }
                            : null,
                    },
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
    }, [open, obstacleSelector]);

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
