// @vitest-environment happy-dom
/**
 * "Add item": two clicks dispatched in ONE frame add one draft row and start one create. Nothing
 * re-renders between two events of one task, so a render-based busy state cannot stop the second.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { CostItemsPanel } from "./CostItemsPanel";

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true, id: "new-1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const addButton = () => [...document.querySelectorAll("button")].find((b) => /add/i.test(b.textContent ?? "")) as HTMLButtonElement;
const creates = () => fetchMock.mock.calls.filter(([, init]) => (init?.body as FormData | undefined)?.get?.("intent") === "create");

describe("CostItemsPanel add item latch", () => {
    it("two clicks in one act start ONE create, and a later click starts another", async () => {
        render(<CostItemsPanel inspectionId="i1" items={[]} reserveEnabled={false} />);
        await act(async () => { addButton().click(); addButton().click(); });
        await settle();
        expect(creates()).toHaveLength(1);
        await act(async () => { addButton().click(); });
        await settle();
        expect(creates()).toHaveLength(2);
    });
});
