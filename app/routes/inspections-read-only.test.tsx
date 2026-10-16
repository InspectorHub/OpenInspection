// @vitest-environment happy-dom
/**
 * `/inspections` — the entry point that creates work is not offered to staff.
 * The server refuses the write either way; this only decides whether the door
 * is shown.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
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

function renderDashboard(role: string, capabilities: Record<string, boolean> = {}, opts: { empty?: boolean } = {}) {
    const context = {
        branding: { defaultLocale: "en-US", defaultTimezone: "UTC" },
        user: { role, capabilities },
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
                        buckets: opts.empty ? EMPTY_BUCKETS : { ...EMPTY_BUCKETS, today: [ONE] },
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

const newButton = (view: ReturnType<typeof renderDashboard>) =>
    view.queryAllByRole("button").find((b) => b.textContent?.includes("New Inspection"));

describe("/inspections — New Inspection is not offered to staff", () => {
    it("is not offered to staff", async () => {
        const view = renderDashboard("staff");
        await view.findByText("742 Evergreen Terrace");
        expect(newButton(view)).toBeUndefined();
    });

    it.each(["inspector", "manager", "owner"])("is offered to %s (positive control)", async (role) => {
        const view = renderDashboard(role);
        await view.findByText("742 Evergreen Terrace");
        expect(newButton(view)).toBeTruthy();
    });
});

describe("/inspections - rows offer an office user only what the server accepts", () => {
    const statusSelect = (view: ReturnType<typeof renderDashboard>) => view.container.querySelector("select");
    const editorLink = (view: ReturnType<typeof renderDashboard>) =>
        view.container.querySelector('a[href="/inspections/insp-1/edit"]');

    it("gives staff no status dropdown and no editor link", async () => {
        const view = renderDashboard("staff", { scheduleOthers: true, editReports: false });
        await view.findByText("742 Evergreen Terrace");
        expect(statusSelect(view)).toBeNull();
        expect(editorLink(view)).toBeNull();
    });

    it("POSITIVE CONTROL - an inspector keeps both", async () => {
        const view = renderDashboard("inspector", { editReports: true });
        await view.findByText("742 Evergreen Terrace");
        expect(statusSelect(view)).not.toBeNull();
        expect(editorLink(view)).not.toBeNull();
    });
});

describe("/inspections - empty list and checklist for an office user", () => {
    it("staff see neither the New Inspection button nor the create sentence in the empty state", async () => {
        const view = renderDashboard("staff", { scheduleOthers: true }, { empty: true });
        await view.findByText("No inspections yet");
        expect(view.queryByText("Create one to get started.")).toBeNull();
        expect(newButton(view)).toBeUndefined();
    });

    it("POSITIVE CONTROL - an inspector keeps both", async () => {
        const view = renderDashboard("inspector", {}, { empty: true });
        await view.findByText("No inspections yet");
        expect(view.queryByText("Create one to get started.")).not.toBeNull();
        expect(newButton(view)).toBeTruthy();
    });
});
