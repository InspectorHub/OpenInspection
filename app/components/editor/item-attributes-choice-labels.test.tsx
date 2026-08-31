// @vitest-environment happy-dom
/**
 * The screen half of the choice-label chain.
 *
 * The other half — the stored token reaching the authority's PDF, and a label
 * stored instead being refused by name — is
 * `tests/unit/statutory-forms/choice-labels.spec.ts`. Neither is worth much
 * alone: showing a label proves nothing if the click stores it, and storing the
 * token proves nothing if the inspector is still reading `blowing_fuses`.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ItemAttributesPanel } from "./ItemAttributesPanel";
import type { ItemAttribute } from "../../lib/types";

/** Three of the thirteen hazard boxes the Citizens four-point form prints. */
const HAZARDS: ItemAttribute = {
  id: "hazards_present",
  name: "Hazards Present",
  type: "multi_select",
  choices: [
    { value: "blowing_fuses", label: "Blowing fuses" },
    { value: "improper_breaker_size", label: "Improper breaker size" },
    { value: "other_explain", label: "Other (explain)" },
  ],
};

const PANEL_TYPE: ItemAttribute = {
  id: "type",
  name: "Type:",
  type: "select",
  choices: [
    { value: "circuit_breaker", label: "Circuit breaker" },
    { value: "fuse", label: "Fuse" },
  ],
};

/** A template written before the pair existed. Its options are bare strings. */
const LEGACY: ItemAttribute = {
  id: "fuel",
  name: "Fuel",
  type: "select",
  choices: ["Natural gas", "Electric"],
};

describe("ItemAttributesPanel — the inspector reads the label, the form gets the value", () => {
  it("shows the authority's wording and never the raw token", () => {
    render(
      <ItemAttributesPanel itemId="i1" attributes={[HAZARDS]} values={{}} onChange={vi.fn()} />
    );
    for (const label of ["Blowing fuses", "Improper breaker size", "Other (explain)"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    // ⚠️ Asserted on the UNDERSCORE, not on the token. `textContent`
    // concatenates without separators, so a probe for "blowing_fuses" can pass
    // while it is on screen and a probe anchored to a word boundary can pass
    // while it is not — that exact mistake shipped a green, blind test on this
    // branch once already. No statutory label the forms print contains an
    // underscore; every internal token does.
    expect(document.body.textContent ?? "").not.toMatch(/_/);
  });

  it("sends the VALUE when a box is ticked, not the wording that was clicked", () => {
    const onChange = vi.fn();
    render(
      <ItemAttributesPanel itemId="i1" attributes={[HAZARDS]} values={{}} onChange={onChange} />
    );
    fireEvent.click(screen.getByLabelText("Improper breaker size"));
    expect(onChange).toHaveBeenCalledWith("i1", "hazards_present", ["improper_breaker_size"]);
  });

  it("ticks a box from the stored VALUE, so a reopened inspection shows the same answer", () => {
    render(
      <ItemAttributesPanel
        itemId="i1"
        attributes={[HAZARDS]}
        values={{ hazards_present: ["blowing_fuses"] }}
        onChange={vi.fn()}
      />
    );
    expect((screen.getByLabelText("Blowing fuses") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Other (explain)") as HTMLInputElement).checked).toBe(false);
  });

  it("puts the value on a select's option and the label in its text", () => {
    const onChange = vi.fn();
    render(
      <ItemAttributesPanel itemId="i1" attributes={[PANEL_TYPE]} values={{}} onChange={onChange} />
    );
    const option = screen.getByText("Circuit breaker") as HTMLOptionElement;
    expect(option.value).toBe("circuit_breaker");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "fuse" } });
    expect(onChange).toHaveBeenCalledWith("i1", "type", "fuse");
  });

  it("leaves a bare-string option meaning value and label are the same word", () => {
    const onChange = vi.fn();
    render(
      <ItemAttributesPanel itemId="i1" attributes={[LEGACY]} values={{}} onChange={onChange} />
    );
    expect((screen.getByText("Natural gas") as HTMLOptionElement).value).toBe("Natural gas");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Electric" } });
    expect(onChange).toHaveBeenCalledWith("i1", "fuel", "Electric");
  });
});
