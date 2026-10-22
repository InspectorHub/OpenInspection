// @vitest-environment happy-dom
/**
 * What a row commit sends. A select commits the value it was just changed to (not the row from before the
 * change), one row never has two updates racing, and a row removed while its create is out leaves no orphan.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, act, fireEvent, screen } from "@testing-library/react";
import { FieldDataSourceProvider } from "../../context";
import type { CostItemView } from "../../data-source-types";
import { createEmptyEditorData, createFakeCostItems, createFakeDataSource } from "../../testing/fake-data-source";
import type { FakeCostItems } from "../../testing/fake-data-source";
import { CostItemsPanel } from "./CostItemsPanel";

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
afterEach(cleanup);

const line = (id: string): CostItemView => ({
  id, system: "roof", component: "c", location: "", action: "repair", costMethod: "lump_sum",
  quantity: null, uom: null, unitCostCents: null, lumpSumCents: 1000,
  eul: null, effAge: null, rul: null, suggestedRemedy: "", bucket: "immediate",
  sectionRef: null, photoRef: null, sortOrder: 0,
});

function mount(costItems: FakeCostItems, items: CostItemView[]) {
  const fake = createFakeDataSource({ data: createEmptyEditorData(), resources: { costItems } });
  render(
    <FieldDataSourceProvider dataSource={fake}>
      <CostItemsPanel inspectionId="i1" items={items} reserveEnabled={false} />
    </FieldDataSourceProvider>,
  );
}

const selectWith = (value: string) =>
  [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === value)) as HTMLSelectElement;

// A raw change event: `fireEvent` flushes React between calls, which is exactly what a same-frame pair must not get.
function pick(select: HTMLSelectElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

const updates = (c: FakeCostItems) =>
  c.writes.flatMap((w) => (w.write.intent === "update" ? [w.write.item] : []));

describe("CostItemsPanel select commits", () => {
  it("a select change saves the value that was just picked, not the row from before the pick", async () => {
    const costItems = createFakeCostItems();
    mount(costItems, [line("a")]);
    await act(async () => { pick(selectWith("long_term"), "long_term"); });
    await settle();
    expect(updates(costItems).map((i) => i.bucket)).toEqual(["long_term"]);
  });

  it("two picks in one frame send two updates in order, the last carrying BOTH values", async () => {
    const costItems = createFakeCostItems();
    mount(costItems, [line("a")]);
    const release = costItems.hold();
    await act(async () => { pick(selectWith("long_term"), "long_term"); pick(selectWith("replace"), "replace"); });
    await settle();
    // The first update is out; the second waits for it instead of racing it.
    expect(updates(costItems)).toHaveLength(1);
    await act(async () => { release(); });
    await settle();
    const sent = updates(costItems);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ bucket: "long_term", action: "replace" });
  });
});

describe("CostItemsPanel remove while a create is out", () => {
  it("a row removed in the same frame as the blur that starts its retry-create is deleted once that create lands (no orphan)", async () => {
    const inner = createFakeCostItems();
    const seen: Array<{ intent: string; itemId?: string }> = [];
    let first = true;
    // The row's first create fails, so it stays a temp row the user can retry by editing it.
    const costItems = Object.assign(Object.create(inner), {
      save: async (id: string, write: Parameters<FakeCostItems["save"]>[1]) => {
        seen.push(write.intent === "delete" ? { intent: write.intent, itemId: write.itemId } : { intent: write.intent });
        if (first) {
          first = false;
          return { ok: false as const };
        }
        return inner.save(id, write);
      },
    }) as FakeCostItems;
    mount(costItems, []);
    await act(async () => { screen.getByRole("button", { name: /add/i }).click(); });
    await settle();
    expect(seen.map((w) => w.intent)).toEqual(["create"]);

    const release = inner.hold();
    const system = document.querySelector("input") as HTMLInputElement;
    await act(async () => { fireEvent.change(system, { target: { value: "x" } }); });
    // The Remove button goes pending a frame after a commit starts, so the removal can only arrive in the SAME
    // frame as the blur that commits: both raw events in one act().
    await act(async () => {
      system.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      (screen.getByRole("button", { name: "Remove" }) as HTMLButtonElement).click();
    });
    await settle();
    expect(seen.map((w) => w.intent)).toEqual(["create", "create"]);

    await act(async () => { release(); });
    await settle();
    expect(seen).toEqual([{ intent: "create" }, { intent: "create" }, { intent: "delete", itemId: "stored-1" }]);
  });
});
