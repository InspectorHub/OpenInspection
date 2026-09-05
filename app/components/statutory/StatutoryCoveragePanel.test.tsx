// @vitest-environment happy-dom
/**
 * The editor's coverage panel.
 *
 * ── THE ASSERTION THIS FILE EXISTS FOR ──────────────────────────────────────
 * `null` and an empty `missing` array are DIFFERENT ANSWERS and a component
 * that renders them alike is worse than one that renders neither. Null means
 * the question could not be answered; empty means it was asked and everything
 * is filled. Show a tick for null and an inspector is told a form is ready when
 * nobody checked. So both are pinned, and each is asserted NOT to look like the
 * other.
 *
 * The second pair is the grouping. A licence number is fixed under Settings and
 * an owner's name is typed on this page; a panel that listed them together
 * sends someone hunting through the report for a field that was never going to
 * be there. The split is asserted per group, and each group is checked NOT to
 * contain the other's field.
 */
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import {
    StatutoryCoveragePanel,
    type StatutoryCoverageData,
} from "~/components/statutory/StatutoryCoveragePanel";

const HREF = "/api/inspections/insp-1/statutory-form/preview.pdf";

/** The production failure, as a fixture: two profile fields, one on the job. */
const MIXED: StatutoryCoverageData = {
    formId: "tx_trec_rei",
    formTitle: "Texas Real Estate Commission Property Inspection Report",
    revision: "REI 7-6",
    requiredTotal: 5,
    missing: [
        { field: "inspector_name", provenance: "pre_inspection" },
        { field: "inspector_license_number", provenance: "pre_inspection" },
        { field: "owner_name", provenance: "per_inspection" },
    ],
};

describe("statutory coverage panel", () => {
    it("renders NOTHING when the question could not be answered", () => {
        const { container } = render(
            <StatutoryCoveragePanel coverage={null} previewHref={HREF} />,
        );
        expect(container.innerHTML).toBe("");
    });

    it("says so out loud when the question WAS asked and nothing is missing", () => {
        // The positive control for the test above. Without it, a component that
        // returned null for everything would pass that one.
        render(
            <StatutoryCoveragePanel
                coverage={{ ...MIXED, missing: [] }}
                previewHref={HREF}
            />,
        );
        expect(screen.getByTestId("statutory-coverage")).toBeTruthy();
        expect(screen.queryByTestId("statutory-coverage-profile")).toBeNull();
        expect(screen.queryByTestId("statutory-coverage-inspection")).toBeNull();
    });

    it("puts the two profile fields under the profile group, and only those", () => {
        render(<StatutoryCoveragePanel coverage={MIXED} previewHref={HREF} />);
        const group = screen.getByTestId("statutory-coverage-profile");
        expect(within(group).getByText(/inspector name/)).toBeTruthy();
        expect(within(group).getByText(/inspector license number/)).toBeTruthy();
        // The negative half: a panel that rendered every missing field in both
        // groups satisfies the two assertions above.
        expect(within(group).queryByText(/owner name/)).toBeNull();
    });

    it("puts the on-the-job field under the inspection group, and only that", () => {
        render(<StatutoryCoveragePanel coverage={MIXED} previewHref={HREF} />);
        const group = screen.getByTestId("statutory-coverage-inspection");
        expect(within(group).getByText(/owner name/)).toBeTruthy();
        expect(within(group).queryByText(/inspector license number/)).toBeNull();
    });

    it("groups an unclassified field with the job, never with the profile", () => {
        // Sending someone to Settings for a field they answer on the page is a
        // WRONG instruction; leaving it here is only a vague one. When the
        // classifier does not know, take the cheaper mistake.
        render(
            <StatutoryCoveragePanel
                coverage={{ ...MIXED, missing: [{ field: "mystery_box", provenance: "unknown" }] }}
                previewHref={HREF}
            />,
        );
        expect(within(screen.getByTestId("statutory-coverage-inspection"))
            .getByText(/mystery box/)).toBeTruthy();
        expect(screen.queryByTestId("statutory-coverage-profile")).toBeNull();
    });

    it("offers the preview even when everything is answered", () => {
        // "Answered" says nothing about whether the value landed in the box the
        // authority prints it in, which is the only thing looking can tell you.
        render(
            <StatutoryCoveragePanel coverage={{ ...MIXED, missing: [] }} previewHref={HREF} />,
        );
        const link = screen.getByRole("link");
        expect(link.getAttribute("href")).toBe(HREF);
    });
});
