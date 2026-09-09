// @vitest-environment happy-dom
/**
 * "Not inspected" and "not present" are different answers, and the report says
 * which one it means.
 *
 * They are not a nicety. The Texas Real Estate Commission's mandatory REI 7-6
 * form gives each its own checkbox and defines them apart: NP when the
 * component is not in the dwelling, NI when it is there but was not inspected —
 * by choice, for safety, or because something blocked access. ASTM E2018 asks
 * the same of a commercial walk-through: record what was not seen and why.
 *
 * The engine already knew. `getNaKind` normalises the tenant's own rating level
 * into `not_inspected` / `not_present`, `inspection-report.service` puts it on
 * every item as `naKind`, and an optional `notInspectedReason` rides beside it,
 * its own comment promising "Phase S renders it". Phase S shipped. Nothing
 * rendered either, and the field-level census found `naKind` unread.
 *
 * WHY THE RATING PILL IS NOT ALREADY THE ANSWER. The pill shows the tenant's
 * LABEL. `getNaKind` falls back to matching the label only after trying the
 * ABBREVIATION, precisely because a workspace may label the level "N/A" while
 * abbreviating it "NI" — and then the pill says "N/A" and the distinction is
 * carried by nothing the client can see. The normalised value is the one thing
 * that always knows.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { ReportItemCard } from "~/components/portal/sections/report/ReportItemCard";
import type { ReportItem } from "~/components/portal/sections/report/types";

const BASE = {
    key: "roof.covering",
    label: "Roof covering",
    rating: "na",
    ratingColor: "#64748b",
    ratingLabel: "N/A",
    severityBucket: "info",
    notes: null,
    photos: [],
} as unknown as ReportItem;

/** Everything the card needs beyond the item; none of it is under test here. */
const INERT = {
    showEstimates: false,
    showPhotos: false,
    mediaVisible: () => false,
    renderMediaTile: () => null,
    selectedForRepair: false,
    onToggleRepairItem: () => {},
};

function renderItem(over: Partial<ReportItem>) {
    render(<ReportItemCard item={{ ...BASE, ...over } as ReportItem} {...INERT} />);
}

describe("an item the inspector did not rate", () => {
    it("says the component was not inspected, even when the label only says N/A", () => {
        renderItem({ naKind: "not_inspected" });
        expect(screen.getByText(/not inspected/i)).toBeTruthy();
    });

    it("says the component is not present, which is a different answer", () => {
        renderItem({ naKind: "not_present" });
        expect(screen.getByText(/not present/i)).toBeTruthy();
    });

    /**
     * The reason is the half TREC and ASTM actually care about — "could not be
     * inspected due to existing conditions or limitations" is worth nothing to
     * a buyer unless the limitation is stated.
     */
    it("states why, when the inspector recorded a reason", () => {
        renderItem({ naKind: "not_inspected", notInspectedReason: "Attic hatch was padlocked" });
        expect(screen.getByText(/padlocked/i)).toBeTruthy();
    });

    // POSITIVE CONTROL: a line rendered unconditionally would pass every case
    // above. An ordinary rated item must gain nothing.
    it("adds nothing to an ordinary rated item", () => {
        renderItem({ rating: "sat", ratingLabel: "Satisfactory", naKind: null });
        expect(screen.queryByText(/not inspected/i)).toBeNull();
        expect(screen.queryByText(/not present/i)).toBeNull();
    });

    // A reason without the kind is a payload this component should not invent
    // a heading for — `naKind` is what says the item is unrated at all.
    it("says nothing when there is no naKind, whatever else is set", () => {
        renderItem({ naKind: null, notInspectedReason: "should not surface" });
        expect(screen.queryByText(/should not surface/i)).toBeNull();
    });
});
