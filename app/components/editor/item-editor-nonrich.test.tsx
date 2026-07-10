import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ItemEditor } from "../../../app/components/editor/ItemEditor";

// Minimal no-op prop bag; ItemEditor tolerates omitted optional callbacks.
const base = {
  sectionTitle: "Roof",
  onRating: vi.fn(),
  onNotes: vi.fn(),
  onNotesBlur: vi.fn(),
};

describe("ItemEditor — item.description hint", () => {
  it("renders the inspector-facing description hint for a rich item", () => {
    render(
      <ItemEditor
        {...base}
        item={{ id: "i1", label: "Roof Covering", type: "rich", description: "Walk the roof; note granule loss." }}
        result={{}}
      />
    );
    expect(screen.getByText("Walk the roof; note granule loss.")).toBeTruthy();
  });

  it("renders the description hint for a non-rich item too", () => {
    render(
      <ItemEditor
        {...base}
        item={{ id: "i2", label: "Year Built", type: "number", description: "From the county record." }}
        result={{}}
      />
    );
    expect(screen.getByText("From the county record.")).toBeTruthy();
  });

  it("omits the hint when no description is set", () => {
    const { container } = render(
      <ItemEditor {...base} item={{ id: "i3", label: "Attic", type: "rich" }} result={{}} />
    );
    expect(container.querySelector('[data-testid="item-description-hint"]')).toBeNull();
  });
});

describe("ItemEditor — non-rich FormField inputs", () => {
  it("renders a number input for a number item and reports value changes via onValue", () => {
    const onValue = vi.fn();
    render(
      <ItemEditor
        {...base}
        item={{ id: "i1", label: "Year Built", type: "number" }}
        result={{}}
        onValue={onValue}
      />
    );
    const input = screen.getByRole("spinbutton"); // <input type="number">
    fireEvent.change(input, { target: { value: "1995" } });
    expect(onValue).toHaveBeenCalledWith(1995);
  });

  it("renders a select input for a select item", () => {
    render(
      <ItemEditor
        {...base}
        item={{ id: "i2", label: "Roof Type", type: "select", options: { choices: ["Shingle", "Tile"] } }}
        result={{ value: "Tile" }}
        onValue={vi.fn()}
      />
    );
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("Tile");
    expect(screen.getByRole("option", { name: "Shingle" })).toBeTruthy();
  });

  it("does NOT render a rating button row or canned tabs for a non-rich item", () => {
    render(
      <ItemEditor
        {...base}
        item={{ id: "i3", label: "Year Built", type: "number", tabs: { defects: [{ id: "d1", title: "x", comment: "y" }] } }}
        result={{}}
        onValue={vi.fn()}
      />
    );
    // Rating button row and canned tabs are rich-only.
    expect(screen.queryByRole("button", { name: /Satisfactory/ })).toBeNull();
    expect(screen.queryByText("Information")).toBeNull();
    expect(screen.queryByText("Defects")).toBeNull();
  });

  it("renders the rating row for a rich item (rich branch preserved)", () => {
    render(
      <ItemEditor
        {...base}
        item={{ id: "i4", label: "Attic", type: "rich" }}
        result={{}}
      />
    );
    // FALLBACK_LEVELS render Satisfactory/Monitor/Defect labels.
    expect(screen.getByText("Satisfactory")).toBeTruthy();
  });
});
