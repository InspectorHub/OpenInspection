// @vitest-environment node
import { describe, it, expect } from "vitest";
import { anchoredDropdownPlacement, DROPDOWN_GAP_PX, DROPDOWN_PREFERRED_MAX_PX } from "~/lib/dropdown-position";

/**
 * Why this exists at all.
 *
 * A typeahead list positioned `absolute` inside a panel whose body is
 * `overflow-y-auto` is CLIPPED by that panel. Measured on the new-inspection
 * wizard at a 1260x615 viewport: the template list was 224px tall starting at
 * y=334, and the scroll container ended at y=350 — 16px of 224 visible, with all
 * 20 templates in the clipped remainder. `position: fixed` escapes an
 * overflow ancestor's clip box (only transform/filter/contain would trap it), so
 * the fix is to portal the list to <body> and place it against the anchor's
 * viewport rect. AddressAutocomplete already did exactly this, with a comment
 * naming the same cause; this module is that logic extracted so the three
 * typeaheads share one implementation instead of three copies (two of which
 * would be missing the next fix).
 *
 * Geometry is pure so every placement branch is testable without a DOM.
 */
const anchor = (top: number, height = 36, left = 100, width = 300) => ({
    top,
    bottom: top + height,
    left,
    width,
});

describe("anchoredDropdownPlacement — the common case", () => {
    it("sits under the anchor, matching its width", () => {
        const p = anchoredDropdownPlacement(anchor(200), 800);
        expect(p.placement).toBe("below");
        expect(p.top).toBe(236 + DROPDOWN_GAP_PX);
        expect(p.left).toBe(100);
        expect(p.width).toBe(300);
    });

    it("caps at the preferred height when there is more room than that", () => {
        const p = anchoredDropdownPlacement(anchor(100), 2000);
        expect(p.maxHeight).toBe(DROPDOWN_PREFERRED_MAX_PX);
    });
});

describe("anchoredDropdownPlacement — running out of room", () => {
    // The bug this replaces did not just clip: it clipped SILENTLY, and the
    // user's only clue was a sliver of one row. A list that cannot fit must
    // still show whole rows it can scroll, never a slice of the first one.
    it("shrinks to the space below rather than overflowing the viewport", () => {
        // Anchor at 400 in a 615-tall viewport: enough room below for a usable
        // list, but less than the preferred height.
        const p = anchoredDropdownPlacement(anchor(400), 615);
        expect(p.placement).toBe("below");
        expect(p.top + p.maxHeight).toBeLessThanOrEqual(615);
        expect(p.maxHeight).toBeLessThan(DROPDOWN_PREFERRED_MAX_PX);
    });

    it("flips above the anchor when below is too cramped to be usable", () => {
        // 30px under the anchor is not a list. Above there are 540px.
        const p = anchoredDropdownPlacement(anchor(560), 615);
        expect(p.placement).toBe("above");
        expect(p.top).toBeLessThan(560);
        expect(p.top).toBeGreaterThanOrEqual(0);
        expect(p.top + p.maxHeight).toBeLessThanOrEqual(560);
    });

    it("stays below when below is cramped but above is worse", () => {
        // Anchor near the top: 40px below, ~10px above. Below still wins.
        const p = anchoredDropdownPlacement(anchor(10), 100);
        expect(p.placement).toBe("below");
    });

    it("never returns a negative top or a zero-height list", () => {
        for (const top of [0, 5, 300, 610, 900]) {
            const p = anchoredDropdownPlacement(anchor(top), 615);
            expect(p.top).toBeGreaterThanOrEqual(0);
            expect(p.maxHeight).toBeGreaterThan(0);
        }
    });
});

describe("anchoredDropdownPlacement — horizontal", () => {
    it("keeps a wide anchor's width (the list is the field, widened by nothing)", () => {
        expect(anchoredDropdownPlacement(anchor(100, 36, 40, 900), 800).width).toBe(900);
    });

    it("pulls back a list that would run off the right edge", () => {
        // Anchor starts at 1100 and is 300 wide in a 1260-wide viewport.
        const p = anchoredDropdownPlacement(anchor(100, 36, 1100, 300), 800, { viewportWidth: 1260 });
        expect(p.left + p.width).toBeLessThanOrEqual(1260);
        expect(p.left).toBeGreaterThanOrEqual(0);
    });

    it("leaves an anchor wider than the viewport starting at the left edge", () => {
        const p = anchoredDropdownPlacement(anchor(100, 36, 0, 1400), 800, { viewportWidth: 1260 });
        expect(p.left).toBe(0);
    });
});
