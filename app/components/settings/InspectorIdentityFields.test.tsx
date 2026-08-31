// @vitest-environment happy-dom
/**
 * The qualification box is the authority's six categories, not a text field.
 *
 * ⚠️ EVERY ASSERTION READS AN ATTRIBUTE, never `textContent`. A rendered
 * `textContent` is concatenated with no separator, so a naive regex over it
 * passes with the defect on screen — that has already happened in this
 * subsystem once.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { InspectorIdentityFields } from "./InspectorIdentityFields";
import { FL_1802_QUALIFICATION_CATEGORIES } from "../../../server/lib/statutory/qualification-categories";

const field = (name: string) => ({ id: name, name });

function renderFields(statutoryQualification: string | null) {
  return render(
    <InspectorIdentityFields
      nameField={field("name")}
      phoneField={field("phone")}
      name="Dana Reyes"
      phone="+1 555 0100"
      statutoryLicenseType="Florida-licensed home inspector"
      statutoryQualification={statutoryQualification}
    />,
  );
}

const radios = (c: HTMLElement) =>
  [...c.querySelectorAll<HTMLInputElement>('input[type="radio"][name="statutoryQualification"]')];

describe("InspectorIdentityFields — statutory qualification", () => {
  it("offers one radio per printed category plus a way back to undeclared", () => {
    // Non-empty guard: a category list that failed to load would make every
    // comparison below a comparison of two empty sets.
    expect(FL_1802_QUALIFICATION_CATEGORIES.length).toBeGreaterThan(0);

    const { container } = renderFields(null);
    const values = radios(container).map((r) => r.value);
    expect(values).toEqual(["", ...FL_1802_QUALIFICATION_CATEGORIES.map((c) => c.value)]);
  });

  it("no longer answers the box with a free-text input", () => {
    const { container } = renderFields(null);
    expect(container.querySelector('input[type="text"][name="statutoryQualification"]')).toBeNull();
    // The placeholder that taught "Building code inspector" — a sentence the
    // form cannot tick a box for — must be gone from the whole rendered tree.
    expect(container.innerHTML).not.toMatch(/placeholder="[^"]*[Bb]uilding code inspector/);
  });

  it("keeps the licence class as free text, because that form draws a line not boxes", () => {
    const { container } = renderFields(null);
    const licence = container.querySelector<HTMLInputElement>('input[name="statutoryLicenseType"]');
    expect(licence?.type).toBe("text");
  });

  it("pre-selects the category already stored", () => {
    const stored = FL_1802_QUALIFICATION_CATEGORIES[1]!.value;
    const { container } = renderFields(stored);
    const checked = radios(container).filter((r) => r.checked).map((r) => r.value);
    expect(checked).toEqual([stored]);
  });

  it("selects nothing but the undeclared option when the column holds free text", () => {
    // The column is plain text and this is the honest reading of a value no box
    // exists for: showing it as chosen would claim the form can print it.
    const { container } = renderFields("Building code inspector");
    const checked = radios(container).filter((r) => r.checked).map((r) => r.value);
    expect(checked).toEqual([""]);
  });

  it("puts the authority's sentence beside each box, and the value inside it", () => {
    const { container } = renderFields(null);
    for (const category of FL_1802_QUALIFICATION_CATEGORIES) {
      const input = container.querySelector<HTMLInputElement>(
        `input[name="statutoryQualification"][value="${category.value}"]`,
      );
      expect(input).not.toBeNull();
      // The label is the sibling text of the control, read from that one label
      // element rather than from the page — see the file header.
      expect(input!.closest("label")?.querySelector("span")?.textContent)
        .toBe(category.printedAs);
    }
  });
});
