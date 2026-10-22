// @vitest-environment happy-dom
/**
 * Every write the panel makes goes through `costItems.save`, and the render state that shows a row busy lands a
 * frame late. So each trigger below is pressed TWICE inside ONE `act()` with native events (fireEvent flushes
 * between calls and would hide the bug) and must reach the data source once, and a later press must still go
 * through.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, act, screen } from "@testing-library/react";
import { FieldDataSourceProvider } from "../../context";
import type { CostItemView } from "../../data-source-types";
import { createEmptyEditorData, createFakeCostItems, createFakeDataSource } from "../../testing/fake-data-source";
import type { FakeCostItems } from "../../testing/fake-data-source";
import { CostItemsPanel } from "./CostItemsPanel";

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
afterEach(cleanup);

const line = (id: string, system: string): CostItemView => ({
  id, system, component: "c", location: "", action: "repair", costMethod: "lump_sum",
  quantity: null, uom: null, unitCostCents: null, lumpSumCents: 1000,
  eul: null, effAge: null, rul: null, suggestedRemedy: "", bucket: "immediate",
  sectionRef: null, photoRef: null, sortOrder: 0,
});

function mount(items: CostItemView[] = []): FakeCostItems {
  const costItems = createFakeCostItems();
  const fake = createFakeDataSource({ data: createEmptyEditorData(), resources: { costItems } });
  render(
    <FieldDataSourceProvider dataSource={fake}>
      <CostItemsPanel inspectionId="i1" items={items} reserveEnabled={false} />
    </FieldDataSourceProvider>,
  );
  return costItems;
}

const addButton = () => [...document.querySelectorAll("button")].find((b) => /add/i.test(b.textContent ?? "")) as HTMLButtonElement;
const intents = (c: FakeCostItems) => c.writes.map((w) => w.write.intent);

describe("CostItemsPanel add item latch", () => {
  it("two clicks in one act start ONE create, and a later click starts another", async () => {
    const costItems = mount();
    await act(async () => { addButton().click(); addButton().click(); });
    await settle();
    expect(intents(costItems)).toEqual(["create"]);
    await act(async () => { addButton().click(); });
    await settle();
    expect(intents(costItems)).toEqual(["create", "create"]);
  });
});

describe("CostItemsPanel delete guard", () => {
  it("two Remove presses in one act send ONE delete, and a later press on another row still goes through", async () => {
    const costItems = mount([line("a", "roof-system"), line("b", "plumbing-system")]);
    const removes = () => screen.getAllByRole("button", { name: "Remove" }) as HTMLButtonElement[];
    const first = removes()[0]!;
    await act(async () => { first.click(); first.click(); });
    await settle();
    expect(costItems.writes.map((w) => w.write)).toEqual([{ intent: "delete", itemId: "a" }]);
    await act(async () => { removes()[0]!.click(); });
    await settle();
    expect(costItems.writes.map((w) => w.write)).toEqual([
      { intent: "delete", itemId: "a" },
      { intent: "delete", itemId: "b" },
    ]);
  });
});
