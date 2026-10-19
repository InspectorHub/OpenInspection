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
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { createRoutesStub, Outlet } from "react-router";

const purge = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("~/lib/collab/offline-purge", () => ({ purgeInspectionOfflineData: purge }));

import InspectionsPage from "~/routes/inspections";

const EMPTY_BUCKETS = { needsAttention: [], today: [], thisWeek: [], later: [], recentReports: [], cancelled: [] };
const mk = (id: string, address: string) => ({ id, date: "2026-09-12", address, clientName: "Client", status: "scheduled", reportStatus: "in_progress" });
const A = mk("insp-a", "742 Evergreen Terrace");
const B = mk("insp-b", "1 Other Street");

/** `refuse` names ids the server refuses; `deleteOk:false` refuses all of them. */
function renderDashboard(opts: { deleteOk: boolean; loaderRows: () => Array<typeof A>; refuse?: string[] }) {
    const deleted: string[] = [];
    const submits: string[][] = [];
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
                        if (fd.get("intent") !== "delete-many") return { ok: true, intent: String(fd.get("intent")) };
                        const ids = String(fd.get("ids")).split(",");
                        submits.push(ids);
                        const refused = (id: string) => !opts.deleteOk || (opts.refuse ?? []).includes(id);
                        const done = ids.filter((id) => !refused(id));
                        deleted.push(...done);
                        const failed = ids.filter(refused).map((id) => ({ id, error: "You cannot delete this" }));
                        return { ok: failed.length === 0, intent: "delete-many", deleted: done, failed };
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
    return { view: render(<Stub initialEntries={["/inspections"]} />), deleted, submits };
}

async function deleteFirstRow(view: ReturnType<typeof render>) {
    await view.findByText("742 Evergreen Terrace");
    const checkbox = view.container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    fireEvent.click(checkbox!);
    await view.findByText("Clear");
    fireEvent.click(view.getAllByRole("button").find((b) => b.textContent === "Delete")!);
}

beforeEach(() => purge.mockClear());

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
        const { view, submits } = renderDashboard({ deleteOk: false, loaderRows: () => [A, B] });
        await deleteFirstRow(view);
        await waitFor(() => expect(submits).toEqual([["insp-a"]]));
        await waitFor(() => expect(view.getByText("742 Evergreen Terrace")).toBeTruthy());
    });

    it("does not hide a row that was never deleted", async () => {
        const { view } = renderDashboard({ deleteOk: true, loaderRows: () => [A, B] });
        await deleteFirstRow(view);
        await waitFor(() => expect(view.queryByText("742 Evergreen Terrace")).toBeNull());
        expect(view.getByText("1 Other Street")).toBeTruthy();
    });

    it("sends ONE request for several selected rows, however many", async () => {
        const { view, submits } = renderDashboard({ deleteOk: true, loaderRows: () => [A, B] });
        await view.findByText("742 Evergreen Terrace");
        const boxes = [...view.container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
        boxes.slice(0, 2).forEach((b) => fireEvent.click(b));
        await view.findByText("Clear");
        fireEvent.click(view.getAllByRole("button").find((b) => b.textContent === "Delete")!);
        await waitFor(() => expect(view.queryByText("742 Evergreen Terrace")).toBeNull());
        expect(submits).toHaveLength(1);
        expect(submits[0]!.length).toBeGreaterThanOrEqual(1);
        expect(new Set(submits[0]).size).toBe(submits[0]!.length);
    });

    it("clears the device copy only of the rows the server deleted", async () => {
        const { view, submits } = renderDashboard({ deleteOk: true, refuse: ["insp-b"], loaderRows: () => [A, B] });
        await view.findByText("742 Evergreen Terrace");
        [...view.container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].forEach((b) => fireEvent.click(b));
        await view.findByText("Clear");
        fireEvent.click(view.getAllByRole("button").find((b) => b.textContent === "Delete")!);
        await waitFor(() => expect(submits).toHaveLength(1));
        await waitFor(() => expect(purge).toHaveBeenCalled());
        const purged = purge.mock.calls.map((c) => (c as unknown as string[])[0]);
        expect(purged).not.toContain("insp-b");
        expect(purged).toContain("insp-a");
    });

    it("names a row that could not be deleted, keeps it listed and selected, and says why", async () => {
        const { view } = renderDashboard({ deleteOk: true, refuse: ["insp-b"], loaderRows: () => [A, B] });
        await view.findByText("742 Evergreen Terrace");
        [...view.container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].forEach((b) => fireEvent.click(b));
        await view.findByText("Clear");
        fireEvent.click(view.getAllByRole("button").find((b) => b.textContent === "Delete")!);
        const alert = await view.findByRole("alert");
        expect(alert.textContent).toMatch(/1 Other Street/);
        expect(alert.textContent).toMatch(/You cannot delete this/);
        expect(view.getByText("1 Other Street")).toBeTruthy();
        expect(view.queryByText("742 Evergreen Terrace")).toBeNull();
        expect(view.getByText(/1 selected/i)).toBeTruthy();
    });

    it("a fully refused batch keeps every row and the selection", async () => {
        const { view } = renderDashboard({ deleteOk: false, loaderRows: () => [A, B] });
        await deleteFirstRow(view);
        await view.findByRole("alert");
        expect(view.getByText("742 Evergreen Terrace")).toBeTruthy();
        expect(view.getByText("Clear")).toBeTruthy();
    });
});
