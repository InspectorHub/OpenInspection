// @vitest-environment happy-dom
/**
 * What a workspace with no inspections in it is shown.
 *
 * The page is built for a busy workspace, and an empty one got the same
 * furniture: four stat cards all reading 0, a focus bar, seven workflow tabs,
 * ten more time/tag filter chips, a search box, Filters and Columns — all of it
 * above the card that tells a new operator to create their first inspection.
 * Every one of those controls narrows a list, and there is no list.
 *
 * `createRoutesStub` does NOT run middleware, which is fine here: this is a
 * rendering question end to end and there is no auth decision in it.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import InspectionsPage from "~/routes/inspections";

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

function renderDashboard(buckets: Record<string, unknown[]>) {
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
            }),
        },
    ]);
    return render(<Stub initialEntries={["/inspections"]} />);
}

/** Labels that exist only to narrow a list. */
const LIST_CONTROLS = ["Awaiting payment", "Needs confirmation", "Columns", "Export"];

describe("/inspections — an empty workspace is not shown a busy workspace's controls", () => {
    it("shows none of the list controls when the workspace has no inspections", async () => {
        const { container, findByText } = renderDashboard(EMPTY_BUCKETS);
        // The one thing that SHOULD be there — so a blank render cannot pass.
        await findByText("No inspections yet");
        for (const label of LIST_CONTROLS) {
            expect(container.textContent).not.toContain(label);
        }
    });

    it("shows them all again as soon as there is one inspection to narrow", async () => {
        const { container, findByText } = renderDashboard({ ...EMPTY_BUCKETS, today: [ONE] });
        await findByText("742 Evergreen Terrace");
        // The positive control. Without it the assertions above would also pass
        // for a page that had simply stopped rendering its controls.
        for (const label of LIST_CONTROLS) {
            expect(container.textContent).toContain(label);
        }
    });
});
