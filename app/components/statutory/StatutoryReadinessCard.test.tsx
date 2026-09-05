// @vitest-environment happy-dom
/**
 * The readiness card — three prerequisites owned by three different people,
 * on the one screen where somebody is already thinking about statutory forms.
 *
 * The assertions worth having are about the ways a readiness view lies:
 * calling something ready when one leg is missing, hiding the state inside a
 * glyph a screen reader cannot tell apart, and claiming readiness for a form
 * that has no revision in force at all.
 */
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import {
    StatutoryReadinessCard,
    type StatutoryReadinessData,
} from "./StatutoryReadinessCard";

const FORM = "fl_oir_b1_1802";

const data = (
    over: Partial<StatutoryReadinessData["forms"][number]> = {},
    licenceClass = { filled: 2, total: 4 },
): StatutoryReadinessData => ({
    forms: [{
        formId: FORM,
        formTitle: "Florida Uniform Mitigation Verification Inspection Form",
        currentRevision: "Rev. 04/26",
        templateInstalled: true,
        sourceStored: true,
        ...over,
    }],
    licenceClass,
});

const row = () => within(screen.getByTestId(`statutory-readiness-${FORM}`));

describe("StatutoryReadinessCard", () => {
    it("says Ready only when all three legs hold", () => {
        render(<StatutoryReadinessCard readiness={data()} />);
        expect(row().getByText("Ready")).toBeTruthy();
    });

    it("is Not ready when the template is missing, even with the PDF stored", () => {
        render(<StatutoryReadinessCard readiness={data({ templateInstalled: false })} />);
        expect(row().getByText("Not ready")).toBeTruthy();
    });

    it("is Not ready when the PDF is missing, even with the template installed", () => {
        render(<StatutoryReadinessCard readiness={data({ sourceStored: false })} />);
        expect(row().getByText("Not ready")).toBeTruthy();
    });

    it("is Not ready when nobody has a licence class", () => {
        // The leg most likely to be forgotten, because it is not the owner's to
        // fill in and it is on a different screen entirely.
        render(<StatutoryReadinessCard readiness={data({}, { filled: 0, total: 4 })} />);
        expect(row().getByText("Not ready")).toBeTruthy();
    });

    it("shows the licence class as a fraction, not a tick", () => {
        // "Some inspectors can and some cannot" is the true state, and a
        // boolean cannot hold it.
        render(<StatutoryReadinessCard readiness={data({}, { filled: 2, total: 4 })} />);
        expect(row().getByText(/2 of 4/)).toBeTruthy();
    });

    it("puts the state in TEXT, not only in the tick glyph", () => {
        // A screen reader reading "✓ Template installed" and "✗ Template
        // installed" identically is the whole failure this row exists to avoid.
        render(<StatutoryReadinessCard readiness={data({ templateInstalled: false })} />);
        const label = row().getByText(/Template installed/);
        expect(label.textContent).toMatch(/missing/i);
    });

    it("refuses to call a form ready when no revision is in force today", () => {
        // Whatever else is configured, there is no document to render onto.
        render(<StatutoryReadinessCard readiness={data({ currentRevision: null })} />);
        expect(row().getByText("Not ready")).toBeTruthy();
        expect(row().getByText(/No revision of this form is in force today/)).toBeTruthy();
        // And it does not offer three ticks about a form that cannot be produced.
        expect(row().queryByText(/Authority PDF stored/)).toBeNull();
    });

    it("names who closes each gap, because two of the three are not the reader's to close", () => {
        render(<StatutoryReadinessCard readiness={data()} />);
        const card = within(screen.getByTestId("statutory-readiness"));
        expect(card.getByText(/administrator/)).toBeTruthy();
        expect(card.getByText(/Settings → Profile/)).toBeTruthy();
    });
});
