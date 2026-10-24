// @vitest-environment happy-dom
/**
 * A new cost line is a local draft until its system and component are filled; the server refuses a line
 * without them. A refused create or update is shown, never swallowed.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { FieldDataSourceProvider } from "../../context";
import type { CommandResult } from "../../commands";
import type { CostItemView } from "../../data-source-types";
import { createEmptyEditorData, createFakeCostItems, createFakeDataSource } from "../../testing/fake-data-source";
import type { FakeCostItems } from "../../testing/fake-data-source";
import { CostItemsPanel } from "./CostItemsPanel";

afterEach(cleanup);

const saved: CostItemView = {
  id: "a", system: "roof", component: "membrane", location: "", action: "repair", costMethod: "lump_sum",
  quantity: null, uom: null, unitCostCents: null, lumpSumCents: 1000,
  eul: null, effAge: null, rul: null, suggestedRemedy: "", bucket: "immediate",
  sectionRef: null, photoRef: null, sortOrder: 0,
};

let reply: (() => CommandResult<{ id?: string }>) | null;
function mount(items: CostItemView[]): FakeCostItems {
  const costItems = createFakeCostItems();
  const inner = costItems.save.bind(costItems);
  reply = null;
  costItems.save = async (id, write) => { const r = reply?.(); return r ?? inner(id, write); };
  const fake = createFakeDataSource({ data: createEmptyEditorData(), resources: { costItems } });
  render(
    <FieldDataSourceProvider dataSource={fake}>
      <CostItemsPanel inspectionId="i1" items={items} reserveEnabled={false} />
    </FieldDataSourceProvider>,
  );
  return costItems;
}
const system = () => screen.getByPlaceholderText("e.g. roof") as HTMLInputElement;
const component = () => screen.getByPlaceholderText("e.g. membrane") as HTMLInputElement;
const add = () => fireEvent.click(screen.getByText("+ Add cost item"));
const tick = () => new Promise((r) => setTimeout(r, 30));

describe("CostItemsPanel draft rows", () => {
  it("adding a row stores nothing, and a half-filled row stays local until both fields hold text", async () => {
    const costItems = mount([]);
    add();
    await tick();
    expect(costItems.writes).toHaveLength(0);

    fireEvent.change(system(), { target: { value: "roof" } });
    fireEvent.blur(system());
    await tick();
    expect(costItems.writes).toHaveLength(0);

    fireEvent.change(component(), { target: { value: "   " } });
    fireEvent.blur(component());
    await tick();
    expect(costItems.writes).toHaveLength(0);

    fireEvent.change(component(), { target: { value: "membrane" } });
    fireEvent.blur(component());
    await waitFor(() => expect(costItems.writes).toHaveLength(1));
    const first = costItems.writes[0]!.write;
    expect(first.intent).toBe("create");
    expect(first.intent === "create" && [first.item.system, first.item.component]).toEqual(["roof", "membrane"]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a select picked on a draft that is still incomplete sends nothing", async () => {
    const costItems = mount([]);
    add();
    const bucket = [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "long_term"))!;
    fireEvent.change(bucket, { target: { value: "long_term" } });
    await tick();
    expect(costItems.writes).toHaveLength(0);
  });
});

describe("CostItemsPanel unsaved drafts are visible and not counted", () => {
  const total = () => screen.getByText("Running total").nextElementSibling!.textContent;

  it("a draft without system or component says it is not saved and stays out of the totals; completing it stores it and counts it", async () => {
    const costItems = mount([]);
    add();
    fireEvent.change(screen.getByLabelText("Lump sum"), { target: { value: "5000" } });
    fireEvent.blur(screen.getByLabelText("Lump sum"));
    fireEvent.change(system(), { target: { value: "roof" } });
    fireEvent.blur(system());
    await tick();
    expect(costItems.writes).toHaveLength(0);
    expect(screen.getByTestId("cost-row-unsaved").textContent).toMatch(/not saved yet/i);
    expect(total()).toBe("$0");

    fireEvent.change(component(), { target: { value: "membrane" } });
    fireEvent.blur(component());
    await waitFor(() => expect(costItems.writes).toHaveLength(1));
    await waitFor(() => expect(screen.queryByTestId("cost-row-unsaved")).toBeNull());
    expect(total()).toBe("$5,000");
  });

  it("CONTROL: a saved row is counted and carries no unsaved note", () => {
    mount([saved]);
    expect(screen.queryByTestId("cost-row-unsaved")).toBeNull();
    expect(total()).toBe("$10");
  });
});

describe("CostItemsPanel refused writes are shown", () => {
  it("a refused create says so, keeps the row, and the next accepted save clears the message", async () => {
    const costItems = mount([]);
    add();
    reply = () => ({ ok: false });
    fireEvent.change(system(), { target: { value: "roof" } });
    fireEvent.change(component(), { target: { value: "membrane" } });
    fireEvent.blur(component());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/could not be saved/i);
    expect(system().value).toBe("roof");

    reply = null;
    await waitFor(() => expect(system().disabled).toBe(false));
    fireEvent.change(component(), { target: { value: "membrane 2" } });
    fireEvent.blur(component());
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(costItems.writes.filter((w) => w.write.intent === "create").length).toBeGreaterThanOrEqual(1);
  });

  it("a refused update of a saved row says so", async () => {
    mount([saved]);
    reply = () => ({ ok: false });
    fireEvent.change(screen.getByDisplayValue("membrane"), { target: { value: "" } });
    fireEvent.blur(screen.getByPlaceholderText("e.g. membrane"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/could not be saved/i);
  });
});
