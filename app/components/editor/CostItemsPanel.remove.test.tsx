// @vitest-environment happy-dom
/**
 * Removing a saved cost line: the row leaves at once, but if the server does not
 * confirm the delete the row comes back where it was, with a message. A removal
 * that fails must never look like one that worked.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, waitFor, screen } from "@testing-library/react";
import { CostItemsPanel } from "./CostItemsPanel";
import type { CostItemView } from "~/components/portal/sections/report/types";

const line = (id: string, system: string): CostItemView => ({
    id, system, component: "c", location: "", action: "repair", costMethod: "lump_sum",
    quantity: null, uom: null, unitCostCents: null, lumpSumCents: 1000,
    eul: null, effAge: null, rul: null, suggestedRemedy: "", bucket: "immediate",
    sectionRef: null, photoRef: null, sortOrder: 0,
});
const ITEMS = [line("a", "roof-system"), line("b", "plumbing-system")];

let reply: () => Response | Promise<Response>;
beforeEach(() => { vi.stubGlobal("fetch", vi.fn(async () => reply())); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const systems = () => [...document.querySelectorAll<HTMLInputElement>("input")].map((i) => i.value).filter((v) => v.endsWith("-system"));
const removeFirst = () => fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]!);

describe("CostItemsPanel remove", () => {
    it("CONTROL: a confirmed delete leaves the row removed and shows no error", async () => {
        reply = () => new Response(JSON.stringify({ success: true }), { status: 200 });
        render(<CostItemsPanel inspectionId="i1" items={ITEMS} reserveEnabled={false} />);
        removeFirst();
        await waitFor(() => expect(systems()).toEqual(["plumbing-system"]));
        await new Promise((r) => setTimeout(r, 40));
        expect(screen.queryByRole("alert")).toBeNull();
        expect(systems()).toEqual(["plumbing-system"]);
    });

    it.each([
        ["the server answers success:false", () => new Response(JSON.stringify({ success: false }), { status: 200 })],
        ["the server answers an error status", () => new Response("{}", { status: 500 })],
        ["the request cannot be made", () => { throw new TypeError("network"); }],
    ] as Array<[string, () => Response]>)("puts the row back in place and says so when %s", async (_n, answer) => {
        reply = answer;
        render(<CostItemsPanel inspectionId="i1" items={ITEMS} reserveEnabled={false} />);
        removeFirst();
        const alert = await screen.findByRole("alert");
        expect(alert.textContent).toMatch(/could not be removed/i);
        expect(systems()).toEqual(["roof-system", "plumbing-system"]);
    });

  it("puts back the row as it was being edited, not as the page loaded it", async () => {
    reply = () => new Response("{}", { status: 500 });
    render(<CostItemsPanel inspectionId="i1" items={ITEMS} reserveEnabled={false} />);
    const first = [...document.querySelectorAll<HTMLInputElement>("input")].find((i) => i.value === "roof-system")!;
    fireEvent.change(first, { target: { value: "roof-edited-system" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]!);
    await screen.findByRole("alert");
    expect(systems()).toEqual(["roof-edited-system", "plumbing-system"]);
  });

  it("the error goes away once a later change is saved", async () => {
    reply = () => new Response("{}", { status: 500 });
    render(<CostItemsPanel inspectionId="i1" items={ITEMS} reserveEnabled={false} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]!);
    await screen.findByRole("alert");
    reply = () => new Response(JSON.stringify({ success: true }), { status: 200 });
    const field = [...document.querySelectorAll<HTMLInputElement>("input")].find((i) => i.value === "roof-system")!;
    fireEvent.change(field, { target: { value: "roof-new-system" } });
    fireEvent.blur(field);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});
