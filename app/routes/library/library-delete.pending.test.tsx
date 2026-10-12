// @vitest-environment happy-dom
/**
 * The confirm button of a library delete must reach the action once when two
 * clicks land in one frame, and must go aria-disabled (not natively disabled)
 * while the delete runs. The fetcher is still "idle" when the second click
 * arrives, so the guard is the submit latch.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, act, fireEvent } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import DefectCategoriesPage from "./defect-categories";
import RatingSystemsPage from "./rating-systems";

afterEach(cleanup);

let calls = 0;
let release: () => void = () => {};
beforeEach(() => {
    calls = 0;
    release = () => {};
});

const CATEGORY = { id: "c1", name: "Safety hazard", color: "#cc0000", drivesSummary: true, sortOrder: 1, isSeed: false };
const SYSTEM = { id: "s1", name: "Three level", slug: "three", description: null, isDefault: false, isSeed: false, levels: [] };

const cases: Array<[string, () => React.ReactElement, Record<string, unknown>]> = [
    ["defect-categories", DefectCategoriesPage, { categories: [CATEGORY], loadFailed: false }],
    ["rating-systems", RatingSystemsPage, { systems: [SYSTEM], loadFailed: false }],
];

async function openConfirm(Component: () => React.ReactElement, data: Record<string, unknown>) {
    const Stub = createRoutesStub([
        {
            path: "/",
            Component,
            loader: () => data,
            action: async () => {
                calls += 1;
                await new Promise<void>((resolve) => { release = resolve; });
                return { ok: true };
            },
        },
    ]);
    render(<Stub initialEntries={["/"]} />);
    fireEvent.click(await screen.findByRole("button", { name: /^delete$/i }));
    return screen.getByRole("button", { name: /confirm/i });
}

describe.each(cases)("/library/%s - delete confirm", (_name, Component, data) => {
    it("lets only one of two same-frame clicks reach the action", async () => {
        const confirm = await openConfirm(Component, data);
        act(() => { confirm.click(); confirm.click(); });
        await waitFor(() => expect(calls).toBe(1));
        expect(calls).toBe(1);
        await act(async () => { release(); });
    });

    it("never marks the confirm button natively disabled while the delete runs", async () => {
        const confirm = await openConfirm(Component, data);
        act(() => { confirm.click(); });
        await waitFor(() => expect(calls).toBe(1));
        expect((confirm as HTMLButtonElement).disabled).toBe(false);
        await act(async () => { release(); });
    });
});
