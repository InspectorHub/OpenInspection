// @vitest-environment happy-dom
/**
 * #275 — the settings panel decides three things the API cannot see:
 * whether the save carries the field at all, what an empty editor means, and
 * what the tenant is shown before they commit.
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { RepairQuickPhrasesPanel } from "./RepairQuickPhrasesPanel";

function renderPanel(repairQuickPhrases: string[] | null) {
  return render(
    <RepairQuickPhrasesPanel
      fieldId="phrases"
      fieldName="repairQuickPhrases"
      repairQuickPhrases={repairQuickPhrases}
    />,
  );
}

const sentinel = (c: HTMLElement) => c.querySelector('input[name="repairQuickPhrasesPresent"]');
const editor = (c: HTMLElement) => c.querySelector("textarea") as HTMLTextAreaElement;

describe("<RepairQuickPhrasesPanel>", () => {
  it("does not submit the field while the list is unconfigured and untouched", () => {
    // Otherwise saving an unrelated company setting freezes the localized
    // defaults into tenant content — invisible today, wrong the moment a
    // Spanish-speaking admin saves for an English-speaking client.
    const { container } = renderPanel(null);
    expect(sentinel(container)).toBeNull();
  });

  it("starts submitting the field as soon as the tenant edits it", () => {
    const { container } = renderPanel(null);
    fireEvent.change(editor(container), { target: { value: "Credit preferred" } });
    expect(sentinel(container)).not.toBeNull();
  });

  it("always submits the field once the list is configured, including when emptied", () => {
    // This is the off switch: an emptied editor must reach the API as [].
    const { container } = renderPanel(["Repair requested"]);
    expect(sentinel(container)).not.toBeNull();
    fireEvent.change(editor(container), { target: { value: "" } });
    expect(sentinel(container)).not.toBeNull();
  });

  it("previews the buttons the client will see, live", () => {
    const { container } = renderPanel(["Repair requested"]);
    fireEvent.change(editor(container), { target: { value: "Credit preferred\nRepair requested" } });
    expect(screen.getByText("Credit preferred")).toBeTruthy();
  });

  it("says what an empty list does instead of implying the defaults come back", () => {
    const { container } = renderPanel(["Repair requested"]);
    fireEvent.change(editor(container), { target: { value: "" } });
    expect(screen.getByText(/no quick buttons/i)).toBeTruthy();
  });
});
