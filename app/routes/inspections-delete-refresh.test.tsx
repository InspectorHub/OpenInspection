// @vitest-environment happy-dom
/**
 * `/inspections` — after Delete, the deleted row leaves the list.
 *
 * The list is the loader's buckets. The batch Delete submits one action per
 * selected row and relies on the router re-running the loader afterwards. If
 * that re-read answers with data that still holds the row (a stale read right
 * after the write), the row used to stay on screen with its selection already
 * cleared, until a manual reload. The page now hides the rows it just asked to
 * delete, and shows them again if the delete is refused.
 */
import { describe, it, expect } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { createRoutesStub, Outlet } from "react-router";

import InspectionsPage from "~/routes/inspections";

const EMPTY_BUCKETS = { needsAttention: [], today: [], thisWeek: [], later: [], recentReports: [], cancelled: [] };
const mk = (id: string, address: string) => ({ id, date: "2026-09-12", address, clientName: "Client", status: "scheduled", reportStatus: "in_progress" });
const A = mk("insp-a", "742 Evergreen Terrace");
const B = mk("insp-b", "1 Other Street");

function renderDashboard(opts: { deleteOk: boolean; loaderRows: () => Array<typeof A> }) {
    const deleted: string[] = [];
    const context = { branding: { defaultLocale: "en-US", defaultTimezone: "UTC" }, user: { capabilities: { deleteInspection: true } } };
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
                    action: async ({ request }) => {
                        const fd = await request.formData();
                        if (fd.get("intent") === "delete") deleted.push(String(fd.get("id")));
                        return { ok: opts.deleteOk, intent: "delete" };
                    },
                    loader: () => ({
                        buckets: { ...EMPTY_BUCKETS, today: opts.loaderRows() },
                        conciergePending: 0, greeting: "Good morning", tags: [], checklistDismissed: true,
                        templateCount: 1, serviceCount: 1, scheduleSet: true, quotaCaps: null, quotaUsage: null, loadFailed: false,
                    }),
                },
            ],
        },
    ]);
    return { view: render(<Stub initialEntries={["/inspections"]} />), deleted };
}

async function deleteFirstRow(view: ReturnType<typeof render>) {
    await view.findByText("742 Evergreen Terrace");
    const checkbox = view.container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    fireEvent.click(checkbox!);
    await view.findByText("Clear");
    fireEvent.click(view.getAllByRole("button").find((b) => b.textContent === "Delete")!);
}

describe("/inspections after Delete", () => {
    it("drops the row even when the re-read still returns it (stale read after the write)", async () => {
        const { view, deleted } = renderDashboard({ deleteOk: true, loaderRows: () => [A, B] });
        await deleteFirstRow(view);
        await waitFor(() => expect(deleted).toEqual(["insp-a"]));
        await waitFor(() => expect(view.queryByText("742 Evergreen Terrace")).toBeNull());
        expect(view.getByText("1 Other Street")).toBeTruthy();
    });

    it("drops the row when the re-read is fresh too (the ordinary case)", async () => {
        let deletedYet = false;
        const { view } = renderDashboard({ deleteOk: true, loaderRows: () => (deletedYet ? [B] : [A, B]) });
        await deleteFirstRow(view);
        deletedYet = true;
        await waitFor(() => expect(view.queryByText("742 Evergreen Terrace")).toBeNull());
    });

    it("shows the row again when the delete is refused", async () => {
        const { view, deleted } = renderDashboard({ deleteOk: false, loaderRows: () => [A, B] });
        await deleteFirstRow(view);
        await waitFor(() => expect(deleted).toEqual(["insp-a"]));
        await waitFor(() => expect(view.getByText("742 Evergreen Terrace")).toBeTruthy());
    });

    it("does not hide a row that was never deleted", async () => {
        const { view } = renderDashboard({ deleteOk: true, loaderRows: () => [A, B] });
        await deleteFirstRow(view);
        await waitFor(() => expect(view.queryByText("742 Evergreen Terrace")).toBeNull());
        expect(view.getByText("1 Other Street")).toBeTruthy();
    });
});
