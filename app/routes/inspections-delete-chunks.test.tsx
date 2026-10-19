// @vitest-environment happy-dom
/**
 * A large selection is deleted in chunks of at most 10, one request after
 * another through the same fetcher, and reads as ONE batch: the rows go at once,
 * the page re-reads once at the end, the bar shows it is working and cannot be
 * edited meanwhile, and the answers are merged (a refusal in one chunk is
 * reported with the others' outcome).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { createRoutesStub, Outlet } from "react-router";

const purge = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("~/lib/collab/offline-purge", () => ({ purgeInspectionOfflineData: purge }));

import InspectionsPage, { shouldRevalidate } from "~/routes/inspections";

const EMPTY = { needsAttention: [], today: [], thisWeek: [], later: [], recentReports: [], cancelled: [] };
const rows = Array.from({ length: 25 }, (_, i) => ({ id: `r${i}`, date: "2026-09-12", address: `${i} Chunk Street`, clientName: "C", status: "scheduled", reportStatus: "in_progress" }));

function mount(opts: { refuse?: string[]; stall?: boolean; garbled?: boolean } = {}) {
    const submits: Array<{ ids: string[]; more: string | null }> = [];
    let loads = 0;
    let release: () => void = () => {};
    const context = { branding: { defaultLocale: "en-US", defaultTimezone: "UTC" }, user: { capabilities: { deleteInspection: true } } };
    const gone = new Set<string>();
    const Stub = createRoutesStub([{
        id: "routes/auth-layout", path: "/", loader: () => ({ context }), Component: () => <Outlet />,
        children: [{
            path: "inspections",
            Component: InspectionsPage,
            shouldRevalidate,
            loader: () => { loads += 1; return { buckets: { ...EMPTY, today: rows.filter((r) => !gone.has(r.id)) }, conciergePending: 0, greeting: "x", tags: [], checklistDismissed: true, templateCount: 1, serviceCount: 1, scheduleSet: true, quotaCaps: null, quotaUsage: null, loadFailed: false }; },
            action: async ({ request }) => {
                const fd = await request.formData();
                if (fd.get("intent") !== "delete-many") return { ok: true, intent: "other" };
                const ids = String(fd.get("ids")).split(",");
                if (opts.garbled) return { ok: true, intent: "other" };
                submits.push({ ids, more: fd.get("more") as string | null });
                if (opts.stall && submits.length === 1) await new Promise<void>((r) => { release = r; });
                const refused = (id: string) => (opts.refuse ?? []).includes(id);
                const done = ids.filter((i) => !refused(i));
                done.forEach((i) => gone.add(i));
                return { ok: done.length === ids.length, intent: "delete-many", deleted: done, failed: ids.filter(refused).map((id) => ({ id, error: "Not allowed" })) };
            },
        }],
    }]);
    return { view: render(<Stub initialEntries={["/inspections"]} />), submits, loads: () => loads, release: () => release() };
}

const selectAllAndDelete = async (view: ReturnType<typeof render>) => {
    await view.findByText("0 Chunk Street");
    fireEvent.click(view.container.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
    fireEvent.click((await view.findAllByRole("button")).find((b) => b.textContent === "Select all")!);
    await view.findByText("25 selected");
    fireEvent.click(view.getAllByRole("button").find((b) => b.textContent === "Delete")!);
};

beforeEach(() => purge.mockClear());

describe("/inspections batch delete in chunks", () => {
    it("sends 10, 10 and 5 ids one after another, and re-reads once at the end", async () => {
        const { view, submits, loads } = mount();
        await view.findByText("0 Chunk Street");
        const before = loads();
        await selectAllAndDelete(view);
        await waitFor(() => expect(submits).toHaveLength(3), { timeout: 5000 });
        expect(submits.map((s) => s.ids.length)).toEqual([10, 10, 5]);
        expect(submits.map((s) => s.more)).toEqual(["1", "1", null]);
        await waitFor(() => expect(view.queryByText("0 Chunk Street")).toBeNull(), { timeout: 5000 });
        await waitFor(() => expect(purge).toHaveBeenCalledTimes(25), { timeout: 5000 });
        expect(loads() - before).toBe(1);
    });

    it("merges the outcome: a refusal in the middle chunk is reported and kept selected", async () => {
        const { view } = mount({ refuse: ["r12"] });
        await selectAllAndDelete(view);
        const alert = await view.findByRole("alert", undefined, { timeout: 5000 });
        expect(alert.textContent).toMatch(/12 Chunk Street/);
        expect(alert.textContent).toMatch(/Not allowed/);
        expect(view.getByText("1 selected")).toBeTruthy();
        expect(purge).not.toHaveBeenCalledWith("r12");
    });

    it("shows the bar working and ignores edits to the selection until the run ends", async () => {
        const { view, release } = mount({ stall: true });
        await selectAllAndDelete(view);
        const del = await waitFor(() => {
            const b = view.getAllByRole("button").find((x) => x.textContent === "Delete")!;
            expect(b.getAttribute("aria-disabled")).toBe("true");
            return b;
        });
        expect(del).toBeTruthy();
        fireEvent.click(view.getAllByRole("button").find((b) => b.textContent === "Clear")!);
        expect(view.getByText("25 selected")).toBeTruthy();
        release();
        await waitFor(() => expect(view.queryByText(/selected/)).toBeNull());
    });
});

describe("/inspections batch delete when the answer is not a batch answer", () => {
    it("brings the rows back, reports them, and ends the run", async () => {
        const { view } = mount({ garbled: true });
        await selectAllAndDelete(view);
        const alert = await view.findByRole("alert", undefined, { timeout: 5000 });
        expect(alert.textContent).toMatch(/Chunk Street/);
        await waitFor(() => expect(view.getByText("0 Chunk Street")).toBeTruthy());
        expect(purge).not.toHaveBeenCalled();
        expect(view.getByText("25 selected")).toBeTruthy();
    });
});

describe("shouldRevalidate for the list", () => {
    const call = (fd: Record<string, string>) => shouldRevalidate({ formData: new URLSearchParams(fd) as unknown as FormData, defaultShouldRevalidate: true } as never);
    it("skips the reload for a chunk that has more behind it, and only that", () => {
        expect(call({ intent: "delete-many", ids: "a", more: "1" })).toBe(false);
        expect(call({ intent: "delete-many", ids: "a" })).toBe(true);
        expect(call({ intent: "status", id: "a" })).toBe(true);
    });
});
