// @vitest-environment happy-dom
/**
 * The brand-colour picker's readability notice (#91).
 *
 * WHAT THIS IS GUARDING. `--ih-primary` is the FILL role and keeps the tenant's
 * exact hex, so ~6.7% of sRGB admits NO readable foreground: colours where both
 * white and the near-black token fall short of 4.5:1. Derivation cannot rescue
 * a fill — only the person choosing it can. So the notice has exactly two jobs,
 * and each needs its own control:
 *
 *   - it must appear, with the real measurement, for a colour in that band;
 *   - it must STAY SILENT for a colour that is fine.
 *
 * The second is not padding. A component that always renders would satisfy the
 * first assertion perfectly while being useless — a warning shown on every
 * colour is decoration, and people learn to scroll past it. The silence case is
 * what makes the warning mean something when it does appear.
 *
 * The numbers are not hard-coded from a table. They come from `fillContrast`,
 * the same function `contrastForeground` uses to pick the button's actual text
 * colour, because a warning quoting a second implementation could disagree with
 * what renders and neither side would know.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { BrandContrastNotice } from "~/components/settings/BrandContrastNotice";
import { fillContrast, AA_NORMAL } from "~/lib/brand";

/** Mid-tone purple: the worst case in the unwinnable band, ~4.21:1. */
const UNREADABLE = "#9f66ae";
/** Deep indigo — white text clears AA comfortably. */
const FINE = "#4338ca";

describe("BrandContrastNotice", () => {
    it("the fixtures are what this test thinks they are", () => {
        // Anti-vacuity for everything below: if the palette maths ever moved,
        // both cases could quietly become the same case and the pair of
        // assertions would still "pass" by agreeing with each other.
        const bad = fillContrast(UNREADABLE)!;
        const good = fillContrast(FINE)!;
        expect(bad.meetsAA, `${UNREADABLE} was supposed to FAIL AA`).toBe(false);
        expect(bad.ratio).toBeLessThan(AA_NORMAL);
        expect(good.meetsAA, `${FINE} was supposed to CLEAR AA`).toBe(true);
    });

    it("names the measurement for a colour that cannot carry text", () => {
        render(<BrandContrastNotice color={UNREADABLE} />);
        const notice = screen.getByRole("status");

        // The ratio the button will actually achieve, not a rounded slogan.
        const measured = fillContrast(UNREADABLE)!.ratio;
        expect(notice.textContent).toContain(
            String(Math.round(measured * 100) / 100),
        );
        expect(notice.textContent).toContain(String(AA_NORMAL));
    });

    it("says what is NOT damaged, so the warning is not read as worse than it is", () => {
        render(<BrandContrastNotice color={UNREADABLE} />);
        const text = screen.getByRole("status").textContent ?? "";
        // Brand-coloured TEXT is derived and stays readable; overstating the
        // blast radius gets a warning dismissed as fast as understating it.
        expect(text).toMatch(/text and links are not affected/i);
        expect(text).toMatch(/filled controls/i);
        // And it must not imply the colour will be changed for them.
        expect(text).toMatch(/exactly as picked/i);
    });

    it("POSITIVE CONTROL: stays silent for a colour that clears AA", () => {
        const { container } = render(<BrandContrastNotice color={FINE} />);
        expect(screen.queryByRole("status")).toBeNull();
        expect(container).toBeEmptyDOMElement();
    });

    it("claims nothing about a colour it could not read", () => {
        // No measurement means no warning: a notice about an unparseable value
        // would be a guess wearing a number.
        for (const bad of [null, undefined, "", "not-a-colour", "#12345"]) {
            const { container } = render(<BrandContrastNotice color={bad} />);
            expect(container, `rendered something for ${JSON.stringify(bad)}`)
                .toBeEmptyDOMElement();
        }
    });
});
