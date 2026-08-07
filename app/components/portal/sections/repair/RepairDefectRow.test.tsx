// @vitest-environment happy-dom
/**
 * #275 — the quick-phrase buttons under the repair-request note field.
 *
 * The one that matters is the APPEND test. A convenience button that eats what
 * the user typed is worse than no button at all, and the failure mode is silent:
 * the note simply reads differently than it did a second ago.
 *
 * `phrases` is OPTIONAL on purpose. The row is the single component both portals
 * render (see app/components/agent/cross-portal-reuse.test.tsx), and the agent
 * surface has no note field at all, so it passes no phrases.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { RepairDefectRow } from "./RepairDefectRow";
import type { Defect } from "../RepairBuilderSection";

const DEFECT = {
  findingKey: "f1",
  sectionId: "s1",
  sectionTitle: "Roof",
  itemId: "i1",
  itemLabel: "Shingles",
  defectTitle: "Missing shingles",
  location: "North slope",
  comment: "Replace missing shingles.",
  category: "safety",
  severityBucket: "defect",
  trade: null,
} as Defect;

function renderRow(opts: { phrases?: string[]; note?: string; onUpdateNote?: () => void }) {
  // isSelected MUST be true: the note field (and therefore the buttons) lives
  // behind `{isSelected && …}`, so a collapsed row makes every query null and
  // an assertion about absence pass for the wrong reason.
  return render(
    <RepairDefectRow
      defect={DEFECT}
      isSelected
      draft={{ requestedCreditCents: null, note: opts.note ?? "" }}
      creditCents={null}
      phrases={opts.phrases}
      onToggle={() => {}}
      onUpdateCredit={() => {}}
      onUpdateNote={opts.onUpdateNote ?? (() => {})}
    />,
  );
}

describe("<RepairDefectRow> quick phrases", () => {
  it("fills an empty note with the phrase", () => {
    const onUpdateNote = vi.fn();
    renderRow({ phrases: ["Replacement requested"], note: "", onUpdateNote });

    fireEvent.click(screen.getByRole("button", { name: "Replacement requested" }));

    expect(onUpdateNote).toHaveBeenCalledWith(DEFECT, "Replacement requested");
  });

  it("APPENDS to an existing note instead of destroying it", () => {
    // The failure that would matter: a user types two sentences, clicks a
    // button for convenience, and loses what they wrote.
    const onUpdateNote = vi.fn();
    renderRow({ phrases: ["Repair requested"], note: "Leaking at the base.", onUpdateNote });

    fireEvent.click(screen.getByRole("button", { name: "Repair requested" }));

    expect(onUpdateNote).toHaveBeenCalledWith(DEFECT, "Leaking at the base. Repair requested");
  });

  it("does not duplicate a phrase already present", () => {
    const onUpdateNote = vi.fn();
    renderRow({ phrases: ["Repair requested"], note: "Repair requested", onUpdateNote });

    fireEvent.click(screen.getByRole("button", { name: "Repair requested" }));

    expect(onUpdateNote).not.toHaveBeenCalled();
  });

  it("renders one button per phrase, in the configured order", () => {
    renderRow({ phrases: ["Credit preferred", "Repair requested"] });

    // Order is the tenant's, not alphabetical: the settings editor is a
    // textarea precisely so line order IS button order.
    const labels = screen
      .getAllByRole("button")
      .map((b) => b.textContent)
      .filter((t) => t === "Credit preferred" || t === "Repair requested");
    expect(labels).toEqual(["Credit preferred", "Repair requested"]);
  });

  it("renders no quick buttons when the tenant configured none", () => {
    const { container } = renderRow({ phrases: [] });

    // The note field itself must still be there — this is the OFF state of the
    // buttons, not of the note. Asserting it also stops this test passing
    // because the whole expanded block failed to render.
    expect(container.querySelector("textarea")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /requested/i })).toBeNull();
  });

  it("renders no quick buttons when the host passes no phrases at all", () => {
    // The agent portal path: one shared row, no note surface, no phrases prop.
    const { container } = renderRow({});

    expect(container.querySelector("textarea")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /requested/i })).toBeNull();
  });
});

describe("<RepairDefectRow> credit field carries no supplied number", () => {
  /**
   * The credit is the CLIENT's ask. A number the platform or the inspector put
   * on the page next to that field — as a hint, or one click away in a button —
   * becomes the client's ask the moment they accept it, and then travels into a
   * document with the inspection company's name on it as if the company had
   * priced the repair.
   *
   * The fixture below MUST carry a non-null estimate. A defect with no estimate
   * data renders no money under the old component either, so an "assert no
   * price" test built on an empty fixture is green against the very code it is
   * supposed to catch. The values are cast on because the field is gone from
   * the `Defect` type — which is the point: even if a payload still ships one,
   * the row must not read it.
   */
  const PRICED = {
    ...DEFECT,
    estimateLow: 100000,
    estimateHigh: 250000,
  } as unknown as Defect;

  function renderPriced() {
    return render(
      <RepairDefectRow
        defect={PRICED}
        isSelected
        draft={{ requestedCreditCents: null, note: "" }}
        creditCents={null}
        onToggle={() => {}}
        onUpdateCredit={() => {}}
        onUpdateNote={() => {}}
      />,
    );
  }

  it("offers no one-click way to adopt a supplied estimate as the credit", () => {
    renderPriced();

    // The credit input must still be on screen — otherwise this assertion
    // would pass simply because the expanded block never rendered.
    expect(screen.getByLabelText(/Shingles/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /estimate/i })).toBeNull();
  });

  it("prints no supplied estimate anywhere in the row", () => {
    const { container } = renderPriced();

    const text = container.textContent ?? "";
    // Both the raw cents and the dollars-rendered forms of the same numbers:
    // the old hint printed `estimateHigh.toLocaleString()`. Not asserting on a
    // bare "$" — the credit field's own label is "Credit Request ($)", so that
    // check would fail for the wrong reason and get deleted by the next reader.
    for (const shown of ["250,000", "100,000", "2,500", "1,000"]) {
      expect(text).not.toContain(shown);
    }
    // No digits at all beyond what the defect prose carries.
    expect(text).not.toMatch(/\d[\d,]{2,}/);
  });
});
