// @vitest-environment happy-dom
/**
 * `/inspections` for office staff: they book jobs and set the booking's status, and
 * nothing on the inspector's side (the completed status, the editor, the setup checklist).
 * The server enforces the same lines; this only decides what is shown.
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

function renderDashboard(role: string, capabilities: Record<string, boolean> = {}, opts: { empty?: boolean; checklistDismissed?: boolean } = {}) {
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
                        checklistDismissed: opts.checklistDismissed ?? true,
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

describe("/inspections — New Inspection is offered to everyone who books", () => {
    it.each(["staff", "inspector", "manager", "owner"])("is offered to %s", async (role) => {
        const view = renderDashboard(role);
        await view.findByText("742 Evergreen Terrace");
        expect(newButton(view)).toBeTruthy();
    });
});

describe("/inspections - rows offer an office user only what the server accepts", () => {
    const statusSelect = (view: ReturnType<typeof renderDashboard>) => view.container.querySelector("select");
    const optionValues = (view: ReturnType<typeof renderDashboard>) =>
        Array.from(view.container.querySelectorAll("select option")).map((o) => (o as HTMLOptionElement).value);
    const editorLink = (view: ReturnType<typeof renderDashboard>) =>
        view.container.querySelector('a[href="/inspections/insp-1/edit"]');

    it("gives staff the booking statuses only, and no editor link", async () => {
        const view = renderDashboard("staff", { scheduleOthers: true, editReports: false });
        await view.findByText("742 Evergreen Terrace");
        expect(optionValues(view)).toEqual(["requested", "scheduled", "confirmed"]);
        expect(editorLink(view)).toBeNull();
    });

    it("POSITIVE CONTROL - an inspector keeps the completed status and the editor link", async () => {
        const view = renderDashboard("inspector", { editReports: true });
        await view.findByText("742 Evergreen Terrace");
        expect(statusSelect(view)).not.toBeNull();
        expect(optionValues(view)).toEqual(["requested", "scheduled", "confirmed", "completed"]);
        expect(editorLink(view)).not.toBeNull();
    });
});

describe("/inspections - empty list and checklist for an office user", () => {
    it("staff get the create sentence and button in the empty state", async () => {
        const view = renderDashboard("staff", { scheduleOthers: true }, { empty: true });
        await view.findByText("No inspections yet");
        expect(view.queryByText("Create one to get started.")).not.toBeNull();
        expect(newButton(view)).toBeTruthy();
    });

    it("the setup checklist is not shown to staff, and is to an inspector (checklist undismissed)", async () => {
        const staff = renderDashboard("staff", {}, { checklistDismissed: false });
        await staff.findByText("742 Evergreen Terrace");
        const staffText = staff.container.textContent ?? "";
        staff.unmount();
        const inspector = renderDashboard("inspector", {}, { checklistDismissed: false });
        await inspector.findByText("742 Evergreen Terrace");
        expect((inspector.container.textContent ?? "").length).toBeGreaterThan(staffText.length);
    });
});
