// @vitest-environment happy-dom
import { useState } from "react";
import { render, fireEvent, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { FieldDataSourceProvider } from "../../context";
import type { CommandDataMap } from "../../commands";
import { createEmptyEditorData, createFakeDataSource } from "../../testing/fake-data-source";
import type { FakeDataSource } from "../../testing/fake-data-source";
import { PropertyInfoForm } from "./PropertyInfoForm";

afterEach(cleanup);

// PropertyInfoForm reads the data source (the #200 "Fetch property details"
// button issues a command), so it renders inside a `FieldDataSourceProvider`.
// `renderPF` wraps any element in one over a fake data source; `autofill`
// answers the lookup for the tests that click the button. The field/commit
// tests below never click it, so no command is ever issued.
// `onSave` fires optimistically on every change with the RAW value typed;
// `onCommit` fires the durable save with a FULL coerced snapshot of every field
// — on blur for text/number/date, on change for select/boolean.
function renderPF(ui: React.ReactElement, autofill?: CommandDataMap["autofill-property-facts"]) {
  const fake: FakeDataSource = createFakeDataSource({ data: createEmptyEditorData() });
  if (autofill) fake.respondWith("autofill-property-facts", autofill);
  const utils = render(<FieldDataSourceProvider dataSource={fake}>{ui}</FieldDataSourceProvider>);
  return { ...utils, fake };
}

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
    const { getByText } = renderPF(
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
    const { queryByText, getByText } = renderPF(
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
    const { getByText } = renderPF(
      <PropertyInfoForm inspection={{ propertyType: "residential" }} />,
    );
    expect(getByText("Lot Size")).toBeTruthy();
  });
});

describe("PropertyInfoForm raw-string typing (Finding 4)", () => {
  it("keeps a fractional Bathrooms value ('2.5') verbatim — onChange is the raw string, not coerced to 2", () => {
    const onSave = vi.fn();
    const { container } = renderPF(
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
    const { container } = renderPF(<Harness initial={{ propertyType: "residential" }} onCommit={onCommit} />);
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
    const { container } = renderPF(<Harness initial={{ propertyType: "residential" }} onCommit={onCommit} />);
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
    const { container } = renderPF(<Harness initial={{ propertyType: "residential" }} onCommit={onCommit} />);
    const input = labelInput(container, "Bathrooms")!;
    fireEvent.change(input, { target: { value: "2.5" } });
    fireEvent.blur(input);
    const facts = onCommit.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(facts.bathrooms).toBe(2.5);
  });

  it("preserves already-entered sibling fields when a second field commits (superset PATCH)", () => {
    const onCommit = vi.fn();
    const { container } = renderPF(<Harness initial={{ propertyType: "residential" }} onCommit={onCommit} />);
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
    const { container } = renderPF(<Harness initial={{ propertyType: "residential", yearBuilt: 1990 }} onCommit={onCommit} />);
    const input = labelInput(container, "Year Built")!;
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    const facts = onCommit.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(facts.yearBuilt).toBeNull();
  });

  it("commits null when a text field (lotSize) is blurred empty", () => {
    const onCommit = vi.fn();
    const { container } = renderPF(<Harness initial={{ propertyType: "residential", lotSize: "old" }} onCommit={onCommit} />);
    const input = labelInput(container, "Lot Size")!;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    const facts = onCommit.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(facts.lotSize).toBeNull();
  });

  it("commits a text field (lotSize) value on blur", () => {
    const onCommit = vi.fn();
    const { container } = renderPF(<Harness initial={{ propertyType: "residential" }} onCommit={onCommit} />);
    const input = labelInput(container, "Lot Size")!;
    fireEvent.change(input, { target: { value: "0.25 acres" } });
    fireEvent.blur(input);
    const facts = onCommit.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(facts.lotSize).toBe("0.25 acres");
  });

  it("still fires onSave optimistically on change with the raw string", () => {
    const onSave = vi.fn();
    const { container } = renderPF(
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
    const { getByText } = renderPF(
      <PropertyInfoForm inspection={{ propertyType: "commercial" }} templateFields={officePreset} />,
    );
    expect(getByText("Net rentable area")).toBeTruthy();
    expect(getByText("Sprinklered")).toBeTruthy();
  });

  it("splits non-dedicated preset fields into a metadata envelope on commit", () => {
    const onCommit = vi.fn();
    const { container } = renderPF(
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
    const { container } = renderPF(
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
    const { container } = renderPF(
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

// #200 — "Fetch property details" autofill button. Issues the `autofill-property-facts`
// command with the address; fills ONLY empty fields (never clobbers manual entry) and
// commits the merged snapshot; degrades with a clear message when unconfigured.
describe("PropertyInfoForm — Fetch property details (#200)", () => {
  function mountAutofill(
    answer: CommandDataMap["autofill-property-facts"],
    handlers: { onSave?: (id: string, v: unknown) => void; onCommit?: (f: Record<string, unknown>) => void },
    extra: Record<string, unknown> = {},
  ) {
    const inspection: Record<string, unknown> = {
      id: "insp-1",
      propertyType: "single_family",
      propertyAddress: "123 Main St, Austin, TX 78701",
      bedrooms: "4", // already set — must NOT be overwritten
      // yearBuilt / sqft / etc. absent = empty = fillable
      ...extra,
    };
    return renderPF(
      <PropertyInfoForm inspection={inspection} onSave={handlers.onSave} onCommit={handlers.onCommit} />,
      answer,
    );
  }

  it("asks the data source for the address, once", async () => {
    const { fake } = mountAutofill({ facts: null, reason: "NO_API_KEY" }, {});
    fireEvent.click(screen.getByRole("button", { name: /fetch property details/i }));
    await waitFor(() => expect(fake.commands).toHaveLength(1));
    expect(fake.commands[0]).toMatchObject({
      inspectionId: "insp-1",
      cmd: { type: "autofill-property-facts", addressString: "123 Main St, Austin, TX 78701" },
    });
  });

  it("fills only empty fields and never clobbers a value the inspector already set", async () => {
    const onSave = vi.fn();
    const onCommit = vi.fn();
    mountAutofill({ facts: { yearBuilt: 1990, bedrooms: 3 }, reason: null }, { onSave, onCommit });

    fireEvent.click(screen.getByRole("button", { name: /fetch property details/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith("yearBuilt", 1990));
    expect(onSave).not.toHaveBeenCalledWith("bedrooms", 3);
    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ yearBuilt: 1990, bedrooms: 4 }));
    await waitFor(() => expect(screen.getByText(/filled 1 field/i)).toBeTruthy());
  });

  it("shows an 'unconfigured' message and commits nothing when the provider key is unset", async () => {
    const onSave = vi.fn();
    const onCommit = vi.fn();
    mountAutofill({ facts: null, reason: "NO_API_KEY" }, { onSave, onCommit });

    fireEvent.click(screen.getByRole("button", { name: /fetch property details/i }));

    await waitFor(() => expect(screen.getByText(/isn.t configured/i)).toBeTruthy());
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("says nothing was found, or that the lookup failed, for the other reasons", async () => {
    mountAutofill({ facts: null, reason: "NOT_FOUND" }, {});
    fireEvent.click(screen.getByRole("button", { name: /fetch property details/i }));
    await waitFor(() => expect(screen.getByText(/no public records/i)).toBeTruthy());
    cleanup();

    mountAutofill({ facts: null, reason: "REQUEST_FAILED" }, {});
    fireEvent.click(screen.getByRole("button", { name: /fetch property details/i }));
    await waitFor(() => expect(screen.getByText(/couldn.t|could not|failed/i)).toBeTruthy());
  });

  it("a FAILED lookup still carries its reason: the message is the reason's, not a generic one", async () => {
    // The action answers ok:false with { facts: null, reason } for a missing key; the decoder keeps `data`.
    const { fake } = mountAutofill({ facts: null, reason: "NO_API_KEY" }, {});
    fake.failExecute("autofill-property-facts", "no key");
    fireEvent.click(screen.getByRole("button", { name: /fetch property details/i }));
    await waitFor(() => expect(screen.getByText(/isn.t configured/i)).toBeTruthy());
  });

  it("says the lookup is running and merges into the form as it is when the answer arrives", async () => {
    // The inspector types a value into a still-empty field while the lookup is out: the answer must
    // not overwrite it (the effect this replaced read the form fresh when the answer landed).
    const onSave = vi.fn();
    const onCommit = vi.fn();
    const fake = createFakeDataSource({ data: createEmptyEditorData() });
    let answer: (r: { ok: boolean; data: CommandDataMap["autofill-property-facts"] }) => void = () => undefined;
    vi.spyOn(fake, "execute").mockImplementation((() =>
      new Promise((resolve) => { answer = resolve as typeof answer; })) as FakeDataSource["execute"]);
    function Harness() {
      const [inspection, setInspection] = useState<Record<string, unknown>>({
        id: "insp-1", propertyType: "single_family", propertyAddress: "123 Main St, Austin, TX 78701",
      });
      return (
        <PropertyInfoForm
          inspection={inspection}
          onSave={(id, v) => { onSave(id, v); setInspection((prev) => ({ ...prev, [id]: v })); }}
          onCommit={onCommit}
        />
      );
    }
    const { container } = render(<FieldDataSourceProvider dataSource={fake}><Harness /></FieldDataSourceProvider>);
    fireEvent.click(screen.getByRole("button", { name: /fetch property details/i }));
    expect(await screen.findByRole("button", { name: /fetching|looking/i })).toBeTruthy();

    fireEvent.change(labelInput(container, "Year Built")!, { target: { value: "1975" } });
    onSave.mockClear();
    answer({ ok: true, data: { facts: { yearBuilt: 1990, sqft: 2000 }, reason: null } });

    await waitFor(() => expect(onSave).toHaveBeenCalledWith("sqft", 2000));
    expect(onSave).not.toHaveBeenCalledWith("yearBuilt", 1990);
    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ yearBuilt: 1975, sqft: 2000 }));
  });

  it("applies nothing when the form is gone before the answer arrives", async () => {
    const onSave = vi.fn();
    const onCommit = vi.fn();
    const fake = createFakeDataSource({ data: createEmptyEditorData() });
    let answer: (r: { ok: boolean; data: CommandDataMap["autofill-property-facts"] }) => void = () => undefined;
    vi.spyOn(fake, "execute").mockImplementation((() =>
      new Promise((resolve) => { answer = resolve as typeof answer; })) as FakeDataSource["execute"]);
    const { unmount } = render(
      <FieldDataSourceProvider dataSource={fake}>
        <PropertyInfoForm
          inspection={{ id: "insp-1", propertyType: "single_family", propertyAddress: "123 Main St, Austin, TX 78701" }}
          onSave={onSave}
          onCommit={onCommit}
        />
      </FieldDataSourceProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /fetch property details/i }));
    unmount();
    answer({ ok: true, data: { facts: { yearBuilt: 1990 }, reason: null } });
    await new Promise((r) => setTimeout(r, 20));
    expect(onSave).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("shows nothing for a lookup that got no answer at all (offline), as the fetcher did", async () => {
    const fake = createFakeDataSource({ data: createEmptyEditorData() });
    vi.spyOn(fake, "execute").mockResolvedValue({ ok: false, error: "Network error" } as never);
    render(
      <FieldDataSourceProvider dataSource={fake}>
        <PropertyInfoForm inspection={{ id: "insp-1", propertyType: "single_family", propertyAddress: "123 Main St, Austin, TX 78701" }} />
      </FieldDataSourceProvider>,
    );
    const btn = screen.getByRole("button", { name: /fetch property details/i });
    fireEvent.click(btn);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(/isn.t configured|filled|no public records/i)).toBeNull();
    // and the button is usable again
    expect(screen.getByRole("button", { name: /fetch property details/i }).getAttribute("aria-disabled")).not.toBe("true");
  });
});
