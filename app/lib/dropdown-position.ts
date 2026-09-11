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

/**
 * What the list must not cover, and why the viewport alone cannot say it.
 *
 * Until F41 this module reasoned about ONE thing: how much room there is before
 * the viewport edge. That is the right question for a clipped list and the wrong
 * question for a covering one. Measured on the public booking page at 1280x720:
 * the Continue button occupied [724,530]-[823,566] and the suggestion list
 * [232,457]-[823,643] — 36px of vertical overlap against a 36px-tall button, so
 * `elementFromPoint` at the button's centre returned a suggestion `<li>`. There
 * was room below by every viewport measure (77px to spare), so no amount of
 * viewport arithmetic would have moved the list. The obstacle has to be named.
 *
 * `top` is the obstacle's own viewport Y. The list is then budgeted against
 * whichever comes first, the obstacle or the viewport floor, and the existing
 * flip-when-cramped rule does the rest: a list that cannot be useful above the
 * button goes above the field, where nothing is in the way.
 */
export interface DropdownObstacle {
    /** Viewport Y of the obstacle's top edge. */
    top: number;
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
    opts?: { viewportWidth?: number; obstacle?: DropdownObstacle | null },
): DropdownPlacement {
    const belowTop = anchor.bottom + DROPDOWN_GAP_PX;
    // The floor for a list placed below is the nearer of the viewport edge and
    // anything the list must not cover. An obstacle ABOVE the field's bottom
    // (scrolled past, or a mismeasurement) is ignored rather than clamping the
    // budget to a negative number — it is not in the way of a list below.
    const obstacleTop = opts?.obstacle?.top;
    const floorBelow = obstacleTop != null && obstacleTop > belowTop
        ? Math.min(viewportHeight, obstacleTop)
        : viewportHeight;
    const spaceBelow = Math.max(0, floorBelow - belowTop - VIEWPORT_MARGIN_PX);
    const spaceAbove = Math.max(0, anchor.top - DROPDOWN_GAP_PX - VIEWPORT_MARGIN_PX);

    // Below by default: it is where a reader looks next. Flip only when below
    // cannot hold a usable list AND above genuinely holds more — a field near the
    // top of a short viewport stays below, because flipping would trade a small
    // list for a smaller one. With an obstacle in play "below" means the space
    // before it, so a button close under the field now triggers this flip; when
    // even above is worse the list stays below and merely gets short, which is
    // the one thing that must never be traded away: it still does not cover.
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
