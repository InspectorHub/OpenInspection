// @vitest-environment happy-dom
/**
 * Removing a saved cost line: the row leaves at once, but if the host does not confirm the delete the row comes
 * back where it was, with a message. A removal that fails must never look like one that worked.
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, waitFor, screen } from "@testing-library/react";
import { FieldDataSourceProvider } from "../../context";
import type { CommandResult } from "../../commands";
import type { CostItemView } from "../../data-source-types";
import { createEmptyEditorData, createFakeCostItems, createFakeDataSource } from "../../testing/fake-data-source";
import { CostItemsPanel } from "./CostItemsPanel";

const line = (id: string, system: string): CostItemView => ({
    id, system, component: "c", location: "", action: "repair", costMethod: "lump_sum",
    quantity: null, uom: null, unitCostCents: null, lumpSumCents: 1000,
    eul: null, effAge: null, rul: null, suggestedRemedy: "", bucket: "immediate",
    sectionRef: null, photoRef: null, sortOrder: 0,
});
const ITEMS = [line("a", "roof-system"), line("b", "plumbing-system")];

let reply: () => CommandResult<{ id?: string }> | Promise<CommandResult<{ id?: string }>>;
beforeEach(() => { reply = () => ({ ok: true, data: {} }); });
afterEach(() => { cleanup(); });

function mount() {
    const costItems = createFakeCostItems();
    costItems.save = async () => reply();
    const fake = createFakeDataSource({ data: createEmptyEditorData(), resources: { costItems } });
    render(
        <FieldDataSourceProvider dataSource={fake}>
            <CostItemsPanel inspectionId="i1" items={ITEMS} reserveEnabled={false} />
        </FieldDataSourceProvider>,
    );
}

const systems = () => [...document.querySelectorAll<HTMLInputElement>("input")].map((i) => i.value).filter((v) => v.endsWith("-system"));
const removeFirst = () => fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]!);

describe("CostItemsPanel remove", () => {
    it("CONTROL: a confirmed delete leaves the row removed and shows no error", async () => {
        mount();
        removeFirst();
        await waitFor(() => expect(systems()).toEqual(["plumbing-system"]));
        await new Promise((r) => setTimeout(r, 40));
        expect(screen.queryByRole("alert")).toBeNull();
        expect(systems()).toEqual(["plumbing-system"]);
    });

    it.each([
        ["the host refuses the delete", () => ({ ok: false }) as CommandResult<{ id?: string }>],
        ["the write cannot be made", () => { throw new TypeError("network"); }],
    ] as Array<[string, () => CommandResult<{ id?: string }>]>)("puts the row back in place and says so when %s", async (_n, answer) => {
        reply = answer;
        mount();
        removeFirst();
        const alert = await screen.findByRole("alert");
        expect(alert.textContent).toMatch(/could not be removed/i);
        expect(systems()).toEqual(["roof-system", "plumbing-system"]);
    });

  it("puts back the row as it was being edited, not as the page loaded it", async () => {
    reply = () => ({ ok: false });
    mount();
    const first = [...document.querySelectorAll<HTMLInputElement>("input")].find((i) => i.value === "roof-system")!;
    fireEvent.change(first, { target: { value: "roof-edited-system" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]!);
    await screen.findByRole("alert");
    expect(systems()).toEqual(["roof-edited-system", "plumbing-system"]);
  });

  it("the error goes away once a later change is saved", async () => {
    reply = () => ({ ok: false });
    mount();
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]!);
    await screen.findByRole("alert");
    reply = () => ({ ok: true, data: {} });
    const field = [...document.querySelectorAll<HTMLInputElement>("input")].find((i) => i.value === "roof-system")!;
    fireEvent.change(field, { target: { value: "roof-new-system" } });
    fireEvent.blur(field);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});
