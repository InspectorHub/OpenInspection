import { useState } from "react";
import { render, fireEvent } from "@testing-library/react";
import { PropertyInfoForm } from "~/components/editor/PropertyInfoForm";

// PropertyInfoForm takes plain callback props (onSave/onCommit) and no
// fetcher, so it renders directly without a router (unlike CompliancePanel).
// `onSave` fires optimistically on every change; `onCommit` fires the durable
// save — on blur for text/number/date, on change for select/boolean.

function labelInput(container: HTMLElement, labelText: string): HTMLInputElement | null {
  const spans = Array.from(container.querySelectorAll("label span span")) as HTMLElement[];
  const match = spans.find((s) => s.textContent === labelText);
  const label = match?.closest("label");
  return (label?.querySelector("input") as HTMLInputElement | null) ?? null;
}

// PropertyInfoForm is fully controlled by the `inspection` prop, so a blur can
// only read an edited value if `onSave` updated that prop first. This harness
// mirrors the production wiring in inspection-edit.tsx: onSave → optimistic
// setInspection; onCommit → the durable save (spied on here).
function Harness({ initial, onCommit }: { initial: Record<string, unknown>; onCommit: (id: string, v: unknown) => void }) {
  const [inspection, setInspection] = useState(initial);
  return (
    <PropertyInfoForm
      inspection={inspection}
      onSave={(id, v) => setInspection((prev) => ({ ...prev, [id]: v }))}
      onCommit={onCommit}
    />
  );
}

describe("PropertyInfoForm field sets", () => {
  it("renders bedrooms/bathrooms for a residential inspection", () => {
    const { getByText } = render(
      <PropertyInfoForm inspection={{ propertyType: "residential" }} />,
    );
    expect(getByText("Bedrooms")).toBeTruthy();
    expect(getByText("Bathrooms")).toBeTruthy();
    expect(getByText("Year Built")).toBeTruthy();
    expect(getByText("Sq Ft")).toBeTruthy();
  });

  it("omits bedrooms/bathrooms and shows Building Area for a commercial inspection", () => {
    const { queryByText, getByText } = render(
      <PropertyInfoForm inspection={{ propertyType: "commercial" }} />,
    );
    expect(queryByText("Bedrooms")).toBeNull();
    expect(queryByText("Bathrooms")).toBeNull();
    expect(getByText("Building Area (Sq Ft)")).toBeTruthy();
    // The plain "Sq Ft" label is relabeled for commercial.
    expect(queryByText("Sq Ft")).toBeNull();
  });

  it("no longer renders unit/county and does render lotSize (Lot Size)", () => {
    const { queryByText, getByText } = render(
      <PropertyInfoForm inspection={{ propertyType: "residential" }} />,
    );
    expect(queryByText("Unit")).toBeNull();
    expect(queryByText("County")).toBeNull();
    expect(getByText("Lot Size")).toBeTruthy();
  });
});

describe("PropertyInfoForm commit timing", () => {
  it("commits a number field on blur with the coerced Number value", () => {
    const onCommit = vi.fn();
    const { container } = render(<Harness initial={{ propertyType: "residential" }} onCommit={onCommit} />);
    const input = labelInput(container, "Year Built")!;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { value: "1990" } });
    // onChange must NOT commit (no keystroke persistence).
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith("yearBuilt", 1990);
  });

  it("commits null when a number field is cleared to empty on blur", () => {
    const onCommit = vi.fn();
    const { container } = render(<Harness initial={{ propertyType: "residential", yearBuilt: 1990 }} onCommit={onCommit} />);
    const input = labelInput(container, "Year Built")!;
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith("yearBuilt", null);
  });

  it("commits null when a text field (lotSize) is blurred empty", () => {
    const onCommit = vi.fn();
    const { container } = render(<Harness initial={{ propertyType: "residential", lotSize: "old" }} onCommit={onCommit} />);
    const input = labelInput(container, "Lot Size")!;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith("lotSize", null);
  });

  it("commits a text field (lotSize) value on blur", () => {
    const onCommit = vi.fn();
    const { container } = render(<Harness initial={{ propertyType: "residential" }} onCommit={onCommit} />);
    const input = labelInput(container, "Lot Size")!;
    fireEvent.change(input, { target: { value: "0.25 acres" } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith("lotSize", "0.25 acres");
  });

  it("still fires onSave optimistically on change", () => {
    const onSave = vi.fn();
    const { container } = render(
      <PropertyInfoForm inspection={{ propertyType: "residential" }} onSave={onSave} />,
    );
    const input = labelInput(container, "Year Built")!;
    fireEvent.change(input, { target: { value: "1985" } });
    expect(onSave).toHaveBeenCalledWith("yearBuilt", 1985);
  });
});

describe("PropertyInfoForm select commit", () => {
  it("commits foundationType on change (discrete select, no blur needed)", () => {
    const onCommit = vi.fn();
    const { container } = render(
      <PropertyInfoForm inspection={{ propertyType: "residential" }} onCommit={onCommit} />,
    );
    const select = container.querySelector("select") as HTMLSelectElement;
    expect(select).toBeTruthy();
    fireEvent.change(select, { target: { value: "slab" } });
    expect(onCommit).toHaveBeenCalledWith("foundationType", "slab");
  });
});
