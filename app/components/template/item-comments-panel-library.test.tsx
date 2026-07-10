import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ItemCommentsPanel } from "~/components/template/ItemCommentsPanel";
import type { TemplateItem } from "~/components/template/types";

const item: TemplateItem = {
  id: "i1",
  label: "Roof Covering",
  type: "rich",
  tabs: { information: [], limitations: [], defects: [] },
};

function renderPanel(onOpenLibrary?: (tab: "information" | "limitations" | "defects") => void) {
  return render(
    <ItemCommentsPanel
      selectedItem={item}
      activeSection={0}
      editingItem="i1"
      updateSections={() => {}}
      addCannedToItem={() => {}}
      removeCannedFromItem={() => {}}
      onOpenLibrary={onOpenLibrary}
    />,
  );
}

describe("ItemCommentsPanel — Browse library entry (module C)", () => {
  it("renders a Browse library button per tab and calls onOpenLibrary with the tab", () => {
    const onOpenLibrary = vi.fn();
    renderPanel(onOpenLibrary);
    fireEvent.click(screen.getByTestId("browse-library-defects"));
    expect(onOpenLibrary).toHaveBeenCalledWith("defects");
    expect(screen.getByTestId("browse-library-information")).toBeTruthy();
    expect(screen.getByTestId("browse-library-limitations")).toBeTruthy();
  });

  it("omits the Browse library button when onOpenLibrary is not provided", () => {
    renderPanel(undefined);
    expect(screen.queryByTestId("browse-library-defects")).toBeNull();
  });
});

describe("ItemCommentsPanel — defect-category chip (Step 4b)", () => {
  const itemWithCategory: TemplateItem = {
    id: "i2",
    label: "Roof Covering",
    type: "rich",
    tabs: {
      information: [{ id: "ri_1", title: "Info", comment: "Serviceable", default: false, category: "safety" }],
      limitations: [],
      defects: [{ id: "rd_1", title: "Defect", comment: "Cracked flue liner", default: false, category: "safety" }],
    },
  };

  it("renders a DefectCategoryChip for a defects-tab entry with a category", () => {
    render(
      <ItemCommentsPanel
        selectedItem={itemWithCategory}
        activeSection={0}
        editingItem="i2"
        updateSections={() => {}}
        addCannedToItem={() => {}}
        removeCannedFromItem={() => {}}
      />,
    );
    expect(screen.getByText("safety")).toBeTruthy();
  });

  it("does not render a chip for an information-tab entry with the same category field set", () => {
    render(
      <ItemCommentsPanel
        selectedItem={itemWithCategory}
        activeSection={0}
        editingItem="i2"
        updateSections={() => {}}
        addCannedToItem={() => {}}
        removeCannedFromItem={() => {}}
      />,
    );
    // Only one chip should render (the defects-tab one) — information tab must not get one.
    expect(screen.getAllByText("safety").length).toBe(1);
  });
});
