// @vitest-environment happy-dom
/**
 * F13 — an item the inspector never rated rendered as a bordered box containing
 * its own title and nothing else.
 *
 * The walkthrough read a published report whose header said
 * "40 TOTAL · 3 SATISFACTORY · 1 DEFECT". The other 36 items appeared in no
 * column of that row, and in the body `Cooling System`, `Ductwork & Venting`,
 * `Supply Lines` and `Drain / Waste / Vent` were titles with no rating pill, no
 * text and no photos. A recipient cannot tell that apart from "the inspector
 * looked and there was nothing to report" — and on an inspection report that is
 * the liability question, not a presentation one. It also lands on the commonest
 * case in production: a report published before it was finished (19 of 36
 * inspections hold no content at all).
 *
 * ⚠️ UNRATED IS NOT THE `Not Inspected` RATING, and the report has to say which
 * it means. `Not Inspected` is an ANSWER — the component was there and the
 * inspector is recording that they did not inspect it, with a reason; it arrives
 * as `naKind` and `report-item-na.test.tsx` covers it. This is the ABSENCE of an
 * answer, and the two must not read alike.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { m } from "~/paraglide/messages";
import { ReportItemCard } from "~/components/portal/sections/report/ReportItemCard";
import type { ReportItem } from "~/components/portal/sections/report/types";

/** The shape the service emits for an item nobody answered: `rating` is
 *  `res.rating ?? null` and `ratingLabel` is `level?.label ?? ratingId`, so both
 *  are null and no pill renders. */
const UNRATED = {
    id: "hvac.cooling",
    label: "Cooling System",
    type: "rich",
    rating: null,
    ratingColor: "#cbd5e1",
    ratingLabel: null,
    severityBucket: "other",
    naKind: null,
    notes: null,
    photos: [],
} as unknown as ReportItem;

const INERT = {
    showEstimates: false,
    showPhotos: false,
    mediaVisible: () => false,
    renderMediaTile: () => null,
    selectedForRepair: false,
    onToggleRepairItem: () => {},
};

function renderItem(over: Partial<ReportItem>) {
    return render(<ReportItemCard item={{ ...UNRATED, ...over } as ReportItem} {...INERT} />);
}

describe("an item with no rating recorded", () => {
    it("is not an empty box: it says the item is unrated", () => {
        renderItem({});
        expect(screen.getByText(/unrated/i)).toBeTruthy();
    });

    it("says no finding was recorded, so a reader cannot read silence as 'all fine'", () => {
        renderItem({});
        expect(screen.getByText(/no finding was recorded/i)).toBeTruthy();
    });

    /**
     * The distinction the form bodies care about. TREC REI 7-6 gives
     * `Not Inspected` its own checkbox and ASTM E2018 asks for what was not seen
     * and why; neither is satisfied by a blank. An unrated item must not claim
     * that answer, or it reports a call the inspector never made.
     *
     * ⚠️ ASSERTED AGAINST THE MESSAGES, NOT A SUBSTRING. A
     * `/not inspected/i.test(textContent)` here fails on the correct
     * implementation, because the body copy NAMES the contrast ("…not the same as
     * an item marked not inspected") — that sentence is the fix, not the defect.
     * What must be absent is the naKind HEADING as this item's state. Both
     * headings render as their own element, so `getByText`'s whole-node matching
     * separates "the card's state word" from "the card mentions the phrase".
     */
    it("does not present itself as 'Not inspected', which is a rating somebody chose", () => {
        renderItem({});
        expect(screen.getByText(m.report_item_unrated())).toBeTruthy();
        expect(screen.queryByText(m.report_item_not_inspected())).toBeNull();
        expect(screen.queryByText(m.report_item_not_present())).toBeNull();
    });

    // An unrated item is still unrated when the inspector typed a note against
    // it. The note is content; the missing rating is still missing.
    it("still says unrated when the item carries notes but no rating", () => {
        renderItem({ notes: "Unit is a 2009 Trane, label photographed." });
        expect(screen.getByText(/unrated/i)).toBeTruthy();
        expect(screen.getByText(/Trane/)).toBeTruthy();
    });

    /**
     * POSITIVE CONTROL. A line rendered unconditionally would pass every case
     * above, so an ordinary rated item must gain nothing — the common case is 40
     * cards and the note belongs on none of the answered ones.
     */
    it("adds nothing to a rated item", () => {
        const { container } = renderItem({ rating: "sat", ratingLabel: "Satisfactory" });
        expect(/unrated/i.test(container.textContent ?? "")).toBe(false);
        expect(/no finding was recorded/i.test(container.textContent ?? "")).toBe(false);
    });

    /**
     * SECOND CONTROL, and the reason `itemIsUnrated` looks at `type`. Only `rich`
     * items carry `ratingOptions`; a `number` / `text` / `boolean` item is a data
     * field — "Year built · 1995" has no rating to be missing, and marking it
     * unrated would invent a gap in the report.
     */
    it("adds nothing to a non-rich data field that has no rating to miss", () => {
        const { container } = renderItem({
            id: "general.year",
            label: "Year built",
            type: "number",
            value: 1995,
        });
        expect(/unrated/i.test(container.textContent ?? "")).toBe(false);
        expect(container.textContent).toContain("1995");
    });
});
