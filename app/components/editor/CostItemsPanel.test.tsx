import { render } from "@testing-library/react";
import { CostItemsPanel } from "./CostItemsPanel";

describe("CostItemsPanel", () => {
  it("renders an empty-state add affordance with zero running totals", () => {
    const { getByText } = render(<CostItemsPanel inspectionId="i1" items={[]} reserveEnabled={false} />);
    expect(getByText(/Cost Items/i)).toBeTruthy();
    expect(getByText(/\$0/)).toBeTruthy(); // running total
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
});
