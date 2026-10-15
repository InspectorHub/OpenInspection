// @vitest-environment happy-dom
/**
 * `/inspections` — who is offered the batch Delete button.
 *
 * Deleting an inspection needs the `deleteInspection` capability on the server;
 * the page only decides whether to offer the door. Without the capability the
 * button must not be there, and with it the button must be (the positive
 * control for the absence).
 */
import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { createRoutesStub, Outlet } from "react-router";

import InspectionsPage from "~/routes/inspections";

const EMPTY_BUCKETS = { needsAttention: [], today: [], thisWeek: [], later: [], recentReports: [], cancelled: [] };
const ONE = {
    id: "insp-1",
    date: "2026-09-12",
    address: "742 Evergreen Terrace",
    clientName: "Marge Simpson",
    status: "scheduled",
    reportStatus: "in_progress",
};

function renderDashboard(canDelete: boolean) {
    const context = {
        branding: { defaultLocale: "en-US", defaultTimezone: "UTC" },
        user: { capabilities: { deleteInspection: canDelete } },
    };
    const Stub = createRoutesStub([
        {
            id: "routes/auth-layout",
            path: "/",
            loader: () => ({ context }),
            Component: () => <Outlet />,
            children: [
                {
                    path: "inspections",
                    Component: InspectionsPage,
                    loader: () => ({
                        buckets: { ...EMPTY_BUCKETS, today: [ONE] },
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
            ],
        },
    ]);
    return render(<Stub initialEntries={["/inspections"]} />);
}

async function selectTheRow(view: ReturnType<typeof renderDashboard>) {
    await view.findByText("742 Evergreen Terrace");
    const checkbox = view.container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!checkbox) throw new Error("no row selection checkbox");
    fireEvent.click(checkbox);
    // The batch bar is what appears once a row is selected; wait for it.
    await view.findByText("Clear");
}

const deleteButton = (view: ReturnType<typeof renderDashboard>) =>
    view.queryAllByRole("button").find((b) => b.textContent === "Delete");

describe("/inspections — batch Delete follows the deleteInspection capability", () => {
    it("is not offered to someone without the capability", async () => {
        const view = renderDashboard(false);
        await selectTheRow(view);
        expect(deleteButton(view)).toBeUndefined();
    });

    it("is offered to someone with it (positive control for the absence above)", async () => {
        const view = renderDashboard(true);
        await selectTheRow(view);
        expect(deleteButton(view)).toBeTruthy();
    });
});
