/**
 * Where a portaled typeahead list goes.
 *
 * The three typeaheads in this app (address, template, contacts) all sit inside
 * panels that scroll their own body, and a list positioned `absolute` inside such
 * a panel is clipped by it — see the spec beside this file for the measurement.
 * `position: fixed` + a portal to <body> escapes that clip box, which means the
 * list no longer inherits its position from the DOM and has to be told where to
 * go. That is this module: pure geometry, one implementation, so a fix to the
 * flip-when-cramped rule reaches all three callers.
 */

/** The anchor's viewport rect — the subset of DOMRect placement reads. */
export interface AnchorRect {
    top: number;
    bottom: number;
    left: number;
    width: number;
}

export interface DropdownPlacement {
    /** Viewport coordinates for `position: fixed`. */
    top: number;
    left: number;
    width: number;
    /** Hard cap so a long list scrolls inside the viewport instead of past it. */
    maxHeight: number;
    placement: "below" | "above";
}

/** Space between the field and its list. */
export const DROPDOWN_GAP_PX = 4;
/** Tallest a list gets when there is room — matches the old `max-h-56`. */
export const DROPDOWN_PREFERRED_MAX_PX = 224;
/** Breathing room kept against the viewport edges. */
const VIEWPORT_MARGIN_PX = 8;
/**
 * Below this, the space under the field is not a list — it is a sliver, which is
 * exactly the failure this module exists to prevent. About two and a half rows.
 */
const MIN_USABLE_PX = 96;

export function anchoredDropdownPlacement(
    anchor: AnchorRect,
    viewportHeight: number,
    opts?: { viewportWidth?: number },
): DropdownPlacement {
    const belowTop = anchor.bottom + DROPDOWN_GAP_PX;
    const spaceBelow = Math.max(0, viewportHeight - belowTop - VIEWPORT_MARGIN_PX);
    const spaceAbove = Math.max(0, anchor.top - DROPDOWN_GAP_PX - VIEWPORT_MARGIN_PX);

    // Below by default: it is where a reader looks next. Flip only when below
    // cannot hold a usable list AND above genuinely holds more — a field near the
    // top of a short viewport stays below, because flipping would trade a small
    // list for a smaller one.
    const flip = spaceBelow < MIN_USABLE_PX && spaceAbove > spaceBelow;
    const space = flip ? spaceAbove : spaceBelow;
    const maxHeight = Math.max(1, Math.min(DROPDOWN_PREFERRED_MAX_PX, space));

    const left = clampLeft(anchor, opts?.viewportWidth);
    return flip
        ? {
              top: Math.max(0, anchor.top - DROPDOWN_GAP_PX - maxHeight),
              left,
              width: anchor.width,
              maxHeight,
              placement: "above",
          }
        : { top: Math.max(0, belowTop), left, width: anchor.width, maxHeight, placement: "below" };
}

/**
 * Pull a list back inside the right edge. A field wider than the viewport (or one
 * already flush left) just starts at 0 — clamping cannot help it, and shifting it
 * left would only move the overflow to the other side.
 */
function clampLeft(anchor: AnchorRect, viewportWidth?: number): number {
    if (viewportWidth == null) return anchor.left;
    return Math.max(0, Math.min(anchor.left, viewportWidth - anchor.width - VIEWPORT_MARGIN_PX));
}
