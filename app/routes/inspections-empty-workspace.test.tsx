// @vitest-environment happy-dom
/**
 * What a workspace too small to need narrowing is shown.
 *
 * The page is built for a busy workspace, and an empty one got the same
 * furniture: four stat cards all reading 0, a focus bar, seven workflow tabs,
 * ten more time/tag filter chips, a search box, Filters and Columns — all of it
 * above the card that tells a new operator to create their first inspection.
 * Every one of those controls narrows a list, and there is no list.
 *
 * The first fix gated that on "no inspections at all", which is not the
 * population the finding described — the account it was measured on had one
 * row, and saw the whole apparatus. The gate is a THRESHOLD
 * (`LIST_CONTROLS_MIN_ROWS`), and the tests below walk it from both sides.
 *
 * `createRoutesStub` does NOT run middleware, which is fine here: this is a
 * rendering question end to end and there is no auth decision in it.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import InspectionsPage from "~/routes/inspections";
import { LIST_CONTROLS_MIN_ROWS } from "~/lib/dashboard-filters";

const EMPTY_BUCKETS = {
    needsAttention: [],
    today: [],
    thisWeek: [],
    later: [],
    recentReports: [],
    cancelled: [],
};

const ONE = {
    id: "insp-1",
    date: "2026-09-12",
    address: "742 Evergreen Terrace",
    clientName: "Marge Simpson",
    status: "scheduled",
    reportStatus: "in_progress",
};

/** `n` distinct rows, so a threshold can be walked one row at a time. */
const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
        ...ONE,
        id: `insp-${i + 1}`,
        address: `${i + 1} Evergreen Terrace`,
    }));

function renderDashboard(
    buckets: Record<string, unknown[]>,
    loaderOverrides: Record<string, unknown> = {},
    entry = "/inspections",
) {
    const Stub = createRoutesStub([
        {
            path: "/inspections",
            Component: InspectionsPage,
            loader: () => ({
                buckets,
                conciergePending: 0,
                greeting: "Good morning",
                tags: [],
                templates: [],
                services: [],
                teamMembers: [],
                checklistDismissed: true,
                templateCount: 1,
                serviceCount: 1,
                scheduleSet: true,
                quotaCaps: null,
                quotaUsage: null,
                loadFailed: false,
                ...loaderOverrides,
            }),
        },
    ]);
    return render(<Stub initialEntries={[entry]} />);
}

/** Labels that exist only to narrow a list. */
const LIST_CONTROLS = ["Awaiting payment", "Needs confirmation", "Columns", "Export"];

describe("/inspections — a list too short to narrow is not shown a busy workspace's controls", () => {
    it("shows none of the list controls when the workspace has no inspections", async () => {
        const { container, findByText } = renderDashboard(EMPTY_BUCKETS);
        // The one thing that SHOULD be there — so a blank render cannot pass.
        await findByText("No inspections yet");
        for (const label of LIST_CONTROLS) {
            expect(container.textContent).not.toContain(label);
        }
    });

    it("shows them all again once the list is long enough to be worth narrowing", async () => {
        const { container, findByText } = renderDashboard({
            ...EMPTY_BUCKETS,
            today: rows(LIST_CONTROLS_MIN_ROWS),
        });
        await findByText("1 Evergreen Terrace");
        // The positive control. Without it the assertions above would also pass
        // for a page that had simply stopped rendering its controls.
        for (const label of LIST_CONTROLS) {
            expect(container.textContent).toContain(label);
        }
    });

    /**
     * F5 residual — the gate was keyed on `length === 0`, and the workspace the
     * density was measured on had ONE inspection. So the account that produced
     * the finding saw exactly what it saw before. The boundary is asserted from
     * BOTH sides at the exact row it sits on: a gate proven only in the hiding
     * direction cannot tell a working threshold from one that hides everything.
     */
    it("still hides them one row BELOW the threshold", async () => {
        const { container, findByText } = renderDashboard({
            ...EMPTY_BUCKETS,
            today: rows(LIST_CONTROLS_MIN_ROWS - 1),
        });
        await findByText("1 Evergreen Terrace");
        for (const label of LIST_CONTROLS) {
            expect(container.textContent).not.toContain(label);
        }
    });

    it("hides them for the single-inspection workspace the finding was measured on", async () => {
        const { container, findByText } = renderDashboard({ ...EMPTY_BUCKETS, today: [ONE] });
        // The list itself is never hidden — only the controls that narrow it.
        await findByText("742 Evergreen Terrace");
        for (const label of LIST_CONTROLS) {
            expect(container.textContent).not.toContain(label);
        }
    });

    it("keeps them while a filter is applied, however short the list has become", async () => {
        // Reachable only because the gate is a threshold: filter a list of six,
        // delete two, and the controls holding the filter would otherwise go
        // away with the filter still on — a short list quietly missing rows.
        const { container, findByText } = renderDashboard(
            { ...EMPTY_BUCKETS, today: rows(LIST_CONTROLS_MIN_ROWS - 1) },
            {},
            "/inspections?workflow=active",
        );
        await findByText("1 Evergreen Terrace");
        for (const label of LIST_CONTROLS) {
            expect(container.textContent).toContain(label);
        }
    });

    it("keeps the getting-started checklist on a workspace below the threshold", async () => {
        // A separate finding made dismissing the checklist non-permanent; the
        // short-list gate must not quietly undo that by hiding it as well.
        const { findByText } = renderDashboard(EMPTY_BUCKETS, { checklistDismissed: false });
        await findByText("Getting started");
    });
});
