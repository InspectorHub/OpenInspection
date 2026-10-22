// @vitest-environment happy-dom
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { FieldDataSourceProvider } from "../../context";
import type { CostItemView } from "../../data-source-types";
import { createEmptyEditorData, createFakeCostItems, createFakeDataSource } from "../../testing/fake-data-source";
import type { FakeCostItems } from "../../testing/fake-data-source";
import { CostItemsPanel } from "./CostItemsPanel";

let costItems: FakeCostItems;
beforeEach(() => {
  costItems = createFakeCostItems();
});

/** Render on a provider whose `costItems` resource is the current fake. */
function render(ui: ReactElement) {
  const fake = createFakeDataSource({ data: createEmptyEditorData(), resources: { costItems } });
  return rtlRender(<FieldDataSourceProvider dataSource={fake}>{ui}</FieldDataSourceProvider>);
}

describe("CostItemsPanel", () => {
  it("renders an empty-state add affordance with zero running totals", () => {
    const { getByText } = render(<CostItemsPanel inspectionId="i1" items={[]} reserveEnabled={false} />);
    expect(getByText(/Cost Items/i)).toBeTruthy();
    expect(getByText(/\$0/)).toBeTruthy(); // running total
  });

  describe("cost export control", () => {
    const oneItem: CostItemView[] = [
      {
        id: "a", system: "roof", component: "membrane", location: "",
        action: "replace", costMethod: "lump_sum",
        quantity: null, uom: null, unitCostCents: null, lumpSumCents: 500000,
        eul: null, effAge: null, rul: null,
        suggestedRemedy: "", bucket: "immediate",
        sectionRef: null, photoRef: null, sortOrder: 0,
      },
    ];

    it("hides the CSV/Excel export links when there are no cost items", () => {
      render(<CostItemsPanel inspectionId="i1" items={[]} reserveEnabled={false} />);
      expect(screen.queryByTestId("cost-export-panel")).toBeNull();
    });

    it("shows CSV + Excel links built by the host's cost-export url once an item exists", () => {
      render(<CostItemsPanel inspectionId="insp-9" items={oneItem} reserveEnabled={false} />);
      const csv = screen.getByTestId("cost-export-csv") as HTMLAnchorElement;
      const xlsx = screen.getByTestId("cost-export-xlsx") as HTMLAnchorElement;
      expect(csv.getAttribute("href")).toBe("/fake/cost-export/insp-9.csv");
      expect(xlsx.getAttribute("href")).toBe("/fake/cost-export/insp-9.xlsx");
      expect(csv.hasAttribute("download")).toBe(true);
      expect(xlsx.hasAttribute("download")).toBe(true);
    });
  });

  it("shows a threshold warning for an under-$3k item", () => {
    const { getByText } = render(
      <CostItemsPanel
        inspectionId="i1"
        reserveEnabled={false}
        items={[
          {
            id: "a", system: "roof", component: "flashing", location: "",
            action: "repair", costMethod: "lump_sum",
            quantity: null, uom: null, unitCostCents: null, lumpSumCents: 100000,
            eul: null, effAge: null, rul: null,
            suggestedRemedy: "", bucket: "immediate",
            sectionRef: null, photoRef: null, sortOrder: 0,
          },
        ]}
      />,
    );
    expect(getByText(/below the \$3,000 threshold/i)).toBeTruthy();
  });

  // Fix wave (task-13b-report.md): the "add row" flow used to fire a fire-and-forget `create` for a blank
  // temp-id row without marking it busy, so a field commit that landed before that create resolved would see
  // `isTempId(id) === true` and fire a SECOND `create` — a silent duplicate cost row. These tests exercise the
  // fix: the row's controls are disabled for the lifetime of the pending create, and even a commit that manages
  // to land anyway is guarded off (defense-in-depth) rather than issuing a duplicate `create`.
  describe("temp-id create race", () => {
    it("disables the new row's controls while its create is pending, and never issues a second create for it", async () => {
      const release = costItems.hold();

      render(<CostItemsPanel inspectionId="i1" items={[]} reserveEnabled={false} />);

      fireEvent.click(screen.getByText("+ Add cost item"));

      // A blank draft is not stored: nothing is sent until its system and component are filled.
      expect(costItems.writes).toHaveLength(0);

      const systemInput = screen.getByPlaceholderText("e.g. roof") as HTMLInputElement;
      fireEvent.change(systemInput, { target: { value: "roof" } });
      fireEvent.change(screen.getByPlaceholderText("e.g. membrane"), { target: { value: "membrane" } });
      fireEvent.blur(systemInput);

      // The create fired once, and now the row is busy: its controls are disabled while it is out.
      expect(costItems.writes).toHaveLength(1);
      expect(systemInput.disabled).toBe(true);
      // Remove is aria-disabled (pending), not native, so focus is never dropped.
      expect(screen.getByText("Remove").closest("button")!.getAttribute("aria-disabled")).toBe("true");

      // Even if a field edit manages to reach the commit handler while the row is still pending (e.g. a blur
      // that lands before React commits the `disabled` attribute), the temp-id + pending-write guard in
      // `commitRow` must refuse to fire a second `create` for this row.
      fireEvent.blur(systemInput);
      expect(costItems.writes).toHaveLength(1);

      // Resolve the create: the temp id swaps to the real stored id and the row's controls re-enable.
      release();
      await waitFor(() => {
        expect((screen.getByPlaceholderText("e.g. roof") as HTMLInputElement).disabled).toBe(false);
      });
      expect(costItems.writes).toHaveLength(1);

      // A subsequent edit now commits as an UPDATE against the real id — never a second create.
      const settledInput = screen.getByPlaceholderText("e.g. roof") as HTMLInputElement;
      fireEvent.change(settledInput, { target: { value: "roof 2" } });
      fireEvent.blur(settledInput);

      await waitFor(() => expect(costItems.writes).toHaveLength(2));
      const update = costItems.writes[1]!.write;
      expect(update.intent).toBe("update");
      expect(update.intent === "update" && update.item.id).toBe("stored-1");

      // Across the row's whole lifecycle, exactly one `create` was ever sent.
      expect(costItems.writes.filter((w) => w.write.intent === "create")).toHaveLength(1);
    });
  });

  it("sends the row as the user edited it, for the inspection the panel was given", async () => {
    const row: CostItemView = {
      id: "a", system: "roof", component: "flashing", location: "", action: "repair", costMethod: "lump_sum",
      quantity: null, uom: null, unitCostCents: null, lumpSumCents: 100000, eul: null, effAge: null, rul: null,
      suggestedRemedy: "", bucket: "immediate", sectionRef: null, photoRef: null, sortOrder: 0,
    };
    render(<CostItemsPanel inspectionId="insp-5" items={[row]} reserveEnabled={false} />);
    const field = screen.getByDisplayValue("flashing") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "step flashing" } });
    fireEvent.blur(field);
    await waitFor(() => expect(costItems.writes).toHaveLength(1));
    const { inspectionId, write } = costItems.writes[0]!;
    expect(inspectionId).toBe("insp-5");
    expect(write.intent).toBe("update");
    expect(write.intent === "update" && write.item.component).toBe("step flashing");
  });
});
