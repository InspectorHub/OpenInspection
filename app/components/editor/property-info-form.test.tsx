import { useState } from "react";
import { render, fireEvent } from "@testing-library/react";
import { PropertyInfoForm } from "~/components/editor/PropertyInfoForm";

// PropertyInfoForm takes plain callback props (onSave/onCommit) and no
// fetcher, so it renders directly without a router (unlike CompliancePanel).
// `onSave` fires optimistically on every change with the RAW value typed;
// `onCommit` fires the durable save with a FULL coerced snapshot of every field
// — on blur for text/number/date, on change for select/boolean.

function labelInput(container: HTMLElement, labelText: string): HTMLInputElement | null {
  const spans = Array.from(container.querySelectorAll("label span span")) as HTMLElement[];
  const match = spans.find((s) => s.textContent === labelText);
  const label = match?.closest("label");
  return (label?.querySelector("input") as HTMLInputElement | null) ?? null;
}

// PropertyInfoForm is fully controlled by the `inspection` prop, so a blur can
// only read an edited value if `onSave` updated that prop first. This harness
// mirrors the production wiring in inspection-edit.tsx: onSave → optimistic
// setInspection (stores the RAW value); onCommit → the durable save (spied on
// here), receiving the full facts object.
function Harness({ initial, onCommit }: { initial: Record<string, unknown>; onCommit: (facts: Record<string, unknown>) => void }) {
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
  it("renders bedrooms/bathrooms plus unit + county for a residential inspection", () => {
    const { getByText } = render(
      <PropertyInfoForm inspection={{ propertyType: "residential" }} />,
    );
    expect(getByText("Bedrooms")).toBeTruthy();
    expect(getByText("Bathrooms")).toBeTruthy();
    expect(getByText("Year Built")).toBeTruthy();
    expect(getByText("Sq Ft")).toBeTruthy();
    expect(getByText("Unit / Suite")).toBeTruthy();
    expect(getByText("County")).toBeTruthy();
  });

  it("omits bedrooms/bathrooms + unit but shows Building Area and County for a commercial inspection", () => {
    const { queryByText, getByText } = render(
      <PropertyInfoForm inspection={{ propertyType: "commercial" }} />,
    );
    expect(queryByText("Bedrooms")).toBeNull();
    expect(queryByText("Bathrooms")).toBeNull();
    // Commercial properties have a county but no unit/suite.
    expect(queryByText("Unit / Suite")).toBeNull();
    expect(getByText("County")).toBeTruthy();
    expect(getByText("Building Area (Sq Ft)")).toBeTruthy();
    // The plain "Sq Ft" label is relabeled for commercial.
    expect(queryByText("Sq Ft")).toBeNull();
  });

  it("renders lotSize (Lot Size)", () => {
    const { getByText } = render(
      <PropertyInfoForm inspection={{ propertyType: "residential" }} />,
    );
    expect(getByText("Lot Size")).toBeTruthy();
  });
});

describe("PropertyInfoForm raw-string typing (Finding 4)", () => {
  it("keeps a fractional Bathrooms value ('2.5') verbatim — onChange is the raw string, not coerced to 2", () => {
    const onSave = vi.fn();
    const { container } = render(
      <PropertyInfoForm inspection={{ propertyType: "residential" }} onSave={onSave} />,
    );
    const input = labelInput(container, "Bathrooms")!;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { value: "2.5" } });
    // onSave gets the RAW string, never Number("2.5") === 2.5-typed / null.
    expect(onSave).toHaveBeenCalledWith("bathrooms", "2.5");
  });

  it("does not clear the input on the transient mid-decimal '2.' keystroke", () => {
    const onCommit = vi.fn();
    const { container } = render(<Harness initial={{ propertyType: "residential" }} onCommit={onCommit} />);
    const input = labelInput(container, "Bathrooms")!;
    fireEvent.change(input, { target: { value: "2." } });
    // Controlled value retains "2." — a coerce here would snap it to "2" or "".
    expect(input.value).toBe("2.");
    fireEvent.change(input, { target: { value: "2.5" } });
    expect(input.value).toBe("2.5");
  });
});

describe("PropertyInfoForm full-snapshot commit (Finding 1)", () => {
  it("commits the WHOLE facts object on blur with the changed field coerced and empty fields → null", () => {
    const onCommit = vi.fn();
    const { container } = render(<Harness initial={{ propertyType: "residential" }} onCommit={onCommit} />);
    const input = labelInput(container, "Year Built")!;
    fireEvent.change(input, { target: { value: "1990" } });
    // onChange must NOT commit (no keystroke persistence).
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith({
      yearBuilt: 1990,
      sqft: null,
      foundationType: null,
      lotSize: null,
      bedrooms: null,
      bathrooms: null,
      unit: null,
      county: null,
    });
  });

  it("commits a fractional bathrooms value coerced to a Number within the full object", () => {
    const onCommit = vi.fn();
    const { container } = render(<Harness initial={{ propertyType: "residential" }} onCommit={onCommit} />);
    const input = labelInput(container, "Bathrooms")!;
    fireEvent.change(input, { target: { value: "2.5" } });
    fireEvent.blur(input);
    const facts = onCommit.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(facts.bathrooms).toBe(2.5);
  });

  it("preserves already-entered sibling fields when a second field commits (superset PATCH)", () => {
    const onCommit = vi.fn();
    const { container } = render(<Harness initial={{ propertyType: "residential" }} onCommit={onCommit} />);
    const year = labelInput(container, "Year Built")!;
    fireEvent.change(year, { target: { value: "1990" } });
    fireEvent.blur(year);
    const county = labelInput(container, "County")!;
    fireEvent.change(county, { target: { value: "Travis County" } });
    fireEvent.blur(county);
    const facts = onCommit.mock.calls.at(-1)![0] as Record<string, unknown>;
    // The county commit still carries the earlier yearBuilt value.
    expect(facts.yearBuilt).toBe(1990);
    expect(facts.county).toBe("Travis County");
  });

  it("commits null when a number field is cleared to empty on blur", () => {
    const onCommit = vi.fn();
    const { container } = render(<Harness initial={{ propertyType: "residential", yearBuilt: 1990 }} onCommit={onCommit} />);
    const input = labelInput(container, "Year Built")!;
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    const facts = onCommit.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(facts.yearBuilt).toBeNull();
  });

  it("commits null when a text field (lotSize) is blurred empty", () => {
    const onCommit = vi.fn();
    const { container } = render(<Harness initial={{ propertyType: "residential", lotSize: "old" }} onCommit={onCommit} />);
    const input = labelInput(container, "Lot Size")!;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    const facts = onCommit.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(facts.lotSize).toBeNull();
  });

  it("commits a text field (lotSize) value on blur", () => {
    const onCommit = vi.fn();
    const { container } = render(<Harness initial={{ propertyType: "residential" }} onCommit={onCommit} />);
    const input = labelInput(container, "Lot Size")!;
    fireEvent.change(input, { target: { value: "0.25 acres" } });
    fireEvent.blur(input);
    const facts = onCommit.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(facts.lotSize).toBe("0.25 acres");
  });

  it("still fires onSave optimistically on change with the raw string", () => {
    const onSave = vi.fn();
    const { container } = render(
      <PropertyInfoForm inspection={{ propertyType: "residential" }} onSave={onSave} />,
    );
    const input = labelInput(container, "Year Built")!;
    fireEvent.change(input, { target: { value: "1985" } });
    expect(onSave).toHaveBeenCalledWith("yearBuilt", "1985");
  });
});

// Commercial subtype-preset persist (design 2026-07-13). When the parent
// threads a subtype preset via `templateFields`, the extra non-dedicated fields
// (nra, sprinklered, ...) render AND commit into a `metadata` envelope, while
// the dedicated columns stay at the top level. A residential/all-dedicated
// preset still emits a flat object (covered by the Finding-1 suite above).
describe("PropertyInfoForm commercial preset metadata split", () => {
  const officePreset = [
    { id: "yearBuilt", label: "Year built", type: "number" as const, group: "Identity" },
    { id: "nra", label: "Net rentable area", type: "number" as const, group: "Physical" },
    { id: "sprinklered", label: "Sprinklered", type: "select" as const, group: "Compliance", options: ["None", "Partial", "Full"] },
  ];

  it("renders subtype-preset fields passed via templateFields", () => {
    const { getByText } = render(
      <PropertyInfoForm inspection={{ propertyType: "commercial" }} templateFields={officePreset} />,
    );
    expect(getByText("Net rentable area")).toBeTruthy();
    expect(getByText("Sprinklered")).toBeTruthy();
  });

  it("splits non-dedicated preset fields into a metadata envelope on commit", () => {
    const onCommit = vi.fn();
    const { container } = render(
      <PropertyInfoForm
        inspection={{ propertyType: "commercial", yearBuilt: 1998, nra: 42000 }}
        templateFields={officePreset}
        onCommit={onCommit}
      />,
    );
    fireEvent.blur(labelInput(container, "Net rentable area")!);
    const facts = onCommit.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(facts.yearBuilt).toBe(1998);
    expect(facts.metadata).toEqual({ nra: 42000, sprinklered: null });
  });

  it("emits a flat object (no metadata key) when every preset field is dedicated", () => {
    const onCommit = vi.fn();
    const dedicatedOnly = [
      { id: "yearBuilt", label: "Year built", type: "number" as const, group: "Identity" },
      { id: "sqft", label: "Building area", type: "number" as const, group: "Physical" },
    ];
    const { container } = render(
      <PropertyInfoForm
        inspection={{ propertyType: "commercial", yearBuilt: 2001 }}
        templateFields={dedicatedOnly}
        onCommit={onCommit}
      />,
    );
    fireEvent.blur(labelInput(container, "Year built")!);
    const facts = onCommit.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(facts).not.toHaveProperty("metadata");
    expect(facts.yearBuilt).toBe(2001);
  });
});

describe("PropertyInfoForm select commit", () => {
  it("commits foundationType on change (discrete select) with the full facts object", () => {
    const onCommit = vi.fn();
    const { container } = render(
      <PropertyInfoForm inspection={{ propertyType: "residential" }} onCommit={onCommit} />,
    );
    const select = container.querySelector("select") as HTMLSelectElement;
    expect(select).toBeTruthy();
    fireEvent.change(select, { target: { value: "slab" } });
    expect(onCommit).toHaveBeenCalledWith({
      yearBuilt: null,
      sqft: null,
      foundationType: "slab",
      lotSize: null,
      bedrooms: null,
      bathrooms: null,
      unit: null,
      county: null,
    });
  });
});
