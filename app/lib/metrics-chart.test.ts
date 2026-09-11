/**
 * F27 — the /metrics month charts drew no bars.
 *
 * The bar element existed, had a background colour, and had `height: 100%`, and
 * it measured 967 × 0 in a real browser. The percentage was resolved against a
 * column whose own height is content-derived (a flex item of an `items-end`
 * row), and a percentage height against an indefinite containing block does not
 * resolve at all.
 *
 * These tests pin the geometry as ARITHMETIC, because arithmetic is the part a
 * test can see: happy-dom does no layout, so a percentage is unfalsifiable
 * there and a px number is the same number a browser would compute.
 */
import { describe, it, expect } from "vitest";
import {
    barHeightPx,
    BAR_MAX_PX,
    BAR_MIN_PX,
    BAR_TRACK_PX,
    BAR_LABELS_PX,
    monthLabel,
} from "./metrics-chart";

describe("barHeightPx", () => {
    it("gives the series maximum the full bar height", () => {
        expect(barHeightPx(7, 7)).toBe(BAR_MAX_PX);
    });

    it("scales a smaller month proportionally, in px", () => {
        // Half the maximum is half the drawable height — and it is a NUMBER of
        // pixels, not a ratio that something downstream has to resolve.
        expect(barHeightPx(4, 8)).toBe(BAR_MAX_PX / 2);
        expect(barHeightPx(2, 8)).toBe(BAR_MAX_PX / 4);
    });

    it("never returns zero for a month in range", () => {
        // A visible floor, same intent as the old `Math.max(pct, 4)` — but 4px
        // instead of 4% of nothing.
        expect(barHeightPx(0, 500)).toBe(BAR_MIN_PX);
        expect(barHeightPx(1, 1_000_000)).toBe(BAR_MIN_PX);
    });

    it("never exceeds the drawable height", () => {
        // Defensive: a value above the claimed maximum must not overflow the
        // track, which would push the month label out of the card.
        expect(barHeightPx(20, 7)).toBe(BAR_MAX_PX);
    });

    it("returns a finite px height for degenerate input", () => {
        // `NaN` here would reach the DOM as the string "NaNpx", which browsers
        // drop — i.e. exactly the invisible bar this module exists to prevent.
        for (const h of [
            barHeightPx(Number.NaN, 10),
            barHeightPx(5, Number.NaN),
            barHeightPx(5, 0),
            barHeightPx(5, -3),
            barHeightPx(-5, 10),
        ]) {
            expect(Number.isFinite(h)).toBe(true);
            expect(h).toBeGreaterThanOrEqual(BAR_MIN_PX);
        }
    });

    it("leaves room in the track for the labels stacked with the bar", () => {
        // The bar, the value above it and the month below it share one `h-40`
        // column. If the bar could take the whole 160px the labels would spill
        // out of the card — so the two numbers are asserted against each other
        // rather than each being written down twice.
        expect(BAR_MAX_PX).toBe(BAR_TRACK_PX - BAR_LABELS_PX);
        expect(BAR_MAX_PX).toBeLessThan(BAR_TRACK_PX);
    });
});

describe("monthLabel", () => {
    it("names the month instead of printing its number", () => {
        // Measured on /metrics: the axis read `09`.
        expect(monthLabel("2026-09", "en")).toBe("Sep");
        // DISCRIMINATING: the bare number must not survive anywhere in the label.
        expect(monthLabel("2026-09", "en")).not.toMatch(/09/);
    });

    it("carries the year on January, where the series changed years", () => {
        expect(monthLabel("2026-01", "en")).toMatch(/Jan/);
        expect(monthLabel("2026-01", "en")).toMatch(/2026/);
        // CONTROL: every other month does not, so the axis stays short.
        expect(monthLabel("2026-02", "en")).not.toMatch(/2026/);
    });

    it("speaks the reader's locale", () => {
        expect(monthLabel("2026-09", "es-419")).not.toBe(monthLabel("2026-09", "en"));
    });

    it("returns an unparseable key unchanged rather than Invalid Date", () => {
        for (const bad of ["", "2026", "2026-13", "2026-00", "not-a-month"]) {
            expect(monthLabel(bad, "en")).toBe(bad);
        }
    });
});
