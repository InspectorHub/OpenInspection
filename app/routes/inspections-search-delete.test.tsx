// @vitest-environment happy-dom
/**
 * `/inspections` search mode — deleting a row keeps the pages already loaded.
 *
 * Search results are fetched page by page ("Load more"). After a delete the
 * router re-reads the data it last fetched, which in search mode is only the
 * LAST page. The accumulated list used to be replaced by that one page, so the
 * earlier pages vanished. Earlier pages must stay, minus the deleted row.
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { createRoutesStub, Outlet } from "react-router";

vi.mock("~/lib/collab/offline-purge", () => ({ purgeInspectionOfflineData: vi.fn(async () => undefined) }));

import InspectionsPage from "~/routes/inspections";

const EMPTY_BUCKETS = { needsAttention: [], today: [], thisWeek: [], later: [], recentReports: [], cancelled: [] };
const row = (id: string, address: string) => ({ id, date: "2026-09-12", address, clientName: "Client", status: "scheduled", reportStatus: "in_progress" });
const item = (id: string, address: string) => ({ id, address, propertyAddress: address, clientName: "Client", clientEmail: null, status: "scheduled", date: "2026-09-12" });
const LOADED = ["a", "b", "c", "d", "e"].map((k) => row(`bucket-${k}`, `${k} Bucket Lane`));

function mount() {
    const gone = new Set<string>();
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
                        if (fd.get("intent") !== "delete-many") return { ok: true, intent: "other" };
                        const ids = String(fd.get("ids")).split(",");
                        ids.forEach((id) => gone.add(id));
                        return { ok: true, intent: "delete-many", deleted: ids, failed: [] };
                    },
                    loader: () => ({
                        buckets: { ...EMPTY_BUCKETS, today: LOADED },
                        conciergePending: 0, greeting: "Good morning", tags: [], checklistDismissed: true,
                        templateCount: 1, serviceCount: 1, scheduleSet: true, quotaCaps: null, quotaUsage: null, loadFailed: false,
                    }),
                },
                {
                    path: "resources/inspection-search",
                    loader: ({ request }) => {
                        const cursor = new URL(request.url).searchParams.get("cursor");
                        const page = cursor ? [item("s3", "3 Third Lane")] : [item("s1", "1 First Lane"), item("s2", "2 Second Lane")];
                        return { inspections: page.filter((p) => !gone.has(p.id)), hasMore: !cursor, nextCursor: cursor ? null : "c1" };
                    },
                },
            ],
        },
    ]);
    return render(<Stub initialEntries={["/inspections"]} />);
}

describe("/inspections search + load more + delete", () => {
    it("keeps the earlier pages and drops only the deleted row", async () => {
        const view = mount();
        const box = await view.findByPlaceholderText("Search...");
        fireEvent.change(box, { target: { value: "Lane" } });
        await view.findByText("1 First Lane", undefined, { timeout: 3000 });
        fireEvent.click(await view.findByText("Load more"));
        await view.findByText("3 Third Lane");

        const firstRow = view.getByText("1 First Lane").closest("div[class*='flex']") as HTMLElement;
        const checkbox = [...view.container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((c) => firstRow.contains(c) || c.closest("[class]")?.parentElement?.textContent?.includes("1 First Lane"));
        fireEvent.click(checkbox!);
        fireEvent.click((await view.findAllByRole("button")).find((b) => b.textContent === "Delete")!);

        await waitFor(() => expect(view.queryByText("1 First Lane")).toBeNull());
        await new Promise((r) => setTimeout(r, 300));
        expect(view.getByText("2 Second Lane")).toBeTruthy();
        expect(view.getByText("3 Third Lane")).toBeTruthy();
    });
});
