// @vitest-environment happy-dom
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { FieldDataSourceProvider } from "../../context";
import type { FieldResources } from "../../data-source";
import type { CostItemView, CostItemsListing } from "../../data-source-types";
import { createEmptyEditorData, createFakeCostItems, createFakeDataSource } from "../../testing/fake-data-source";
import { CostItemsHost } from "./CostItemsHost";

afterEach(cleanup);

const REAL: CostItemView = {
  id: "real-1", system: "roof", component: "Roof membrane", location: "",
  action: "repair", costMethod: "lump_sum",
  quantity: null, uom: null, unitCostCents: null, lumpSumCents: 500000,
  eul: 20, effAge: 12, rul: 8,
  suggestedRemedy: "", bucket: "long_term",
  sectionRef: null, photoRef: null, sortOrder: 0,
};

function mount(resources: FieldResources, inspectionId = "insp-1") {
  const fake = createFakeDataSource({ data: createEmptyEditorData(), resources });
  return render(
    <FieldDataSourceProvider dataSource={fake}>
      <CostItemsHost open onClose={() => {}} inspectionId={inspectionId} />
    </FieldDataSourceProvider>,
  );
}

// Final-review fix (task-14): `CostItemsHost` used to seed its read to an "empty" sentinel and render
// `<CostItemsPanel>` unconditionally. Since `CostItemsPanel` does `useState(items)` (captured once, at mount)
// and `Drawer` unmounts/remounts the Panel on every open/close, the FIRST open of an inspection that already
// has cost items mounted the Panel before the read resolved — so it froze on `items=[]` / `reserveEnabled=false`
// forever, hiding existing rows and the reserve (EUL/EFF AGE/RUL) fields. These tests reproduce that race with
// a deferred read and assert the Panel eventually shows the real, already-loaded data.
describe("CostItemsHost", () => {
  it("shows existing cost items (and reserve fields) once the deferred read resolves on first open", async () => {
    let resolveList!: (v: CostItemsListing) => void;
    const costItems = createFakeCostItems();
    costItems.list = () => new Promise<CostItemsListing>((resolve) => { resolveList = resolve; });

    mount({ costItems });

    // While the read is in flight the Panel must NOT be mounted yet — a premature mount is exactly what froze
    // it on stale/empty props before the fix.
    expect(screen.queryByDisplayValue(/Roof membrane/i)).toBeNull();
    expect(screen.getByText(/Loading/i)).toBeTruthy();

    resolveList({ items: [REAL], reserveEnabled: true });

    // Once the read resolves, the Panel mounts fresh with the REAL items.
    await waitFor(() => expect(screen.getByDisplayValue("Roof membrane")).toBeTruthy());
    expect(screen.getByText(/EUL/i)).toBeTruthy();
    expect(screen.getByText(/RUL/i)).toBeTruthy();
  });

  it("asks for the inspection it was opened on, and keeps the reserve fields hidden when the tenant has them off", async () => {
    const costItems = createFakeCostItems([REAL]);
    mount({ costItems }, "insp-7");
    await waitFor(() => expect(screen.getByDisplayValue("Roof membrane")).toBeTruthy());
    expect(costItems.lists).toEqual(["insp-7"]);
    expect(screen.queryByText(/EUL/i)).toBeNull();
  });

  it("still renders the Panel's empty state once a genuinely-empty read resolves", async () => {
    mount({ costItems: createFakeCostItems() }, "insp-2");
    await waitFor(() => expect(screen.getByText(/Nothing recorded yet/i)).toBeTruthy());
  });

  it("fails soft: a read that rejects, or a host with no cost lines, still renders the Panel (empty-but-loaded)", async () => {
    const costItems = createFakeCostItems();
    costItems.list = () => Promise.reject(new Error("network down"));
    mount({ costItems }, "insp-3");
    await waitFor(() => expect(screen.getByText(/Nothing recorded yet/i)).toBeTruthy());
    cleanup();

    mount({}, "insp-4");
    await waitFor(() => expect(screen.getByText(/Nothing recorded yet/i)).toBeTruthy());
  });
});
