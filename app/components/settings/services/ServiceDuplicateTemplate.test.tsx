/**
 * Two services defaulting to the same template is the single most common way a
 * tenant ends up with duplicate reports — the competitor keeps an FAQ entry
 * answering exactly this: "If you're seeing multiple reports generating on your
 * inspections, you may have the same template defaulted for both your primary
 * service and your add-on services."
 *
 * Naming the other service is the whole value. "This template is already in
 * use" is not actionable; "Standard Home Inspection already uses this template"
 * is. And it warns rather than blocks — there are legitimate reasons to want it,
 * so the failure mode being prevented is surprise, not invalidity.
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import { ServiceFields } from "~/components/settings/services/ServiceFields";

const TEMPLATES = [
  { id: "tpl-residential", name: "Standard Residential Inspection" },
  { id: "tpl-sewer", name: "Sewer Scope Inspection" },
];

const OTHERS = [
  { id: "svc-standard", name: "Standard Home Inspection", templateId: "tpl-residential" },
  { id: "svc-prelist", name: "Pre-Listing Inspection", templateId: "tpl-residential" },
  { id: "svc-sewer", name: "Sewer Scope", templateId: "tpl-sewer" },
];

/** conform's field metas, reduced to what ServiceFields actually reads. */
const field = (name: string) => ({ id: `f-${name}`, name, errors: undefined });
const FIELDS = {
  name: field("name"), description: field("description"), price: field("price"),
  durationMinutes: field("durationMinutes"), templateId: field("templateId"),
} as never;

function renderFields(otherServices = OTHERS, initialTemplateId = "") {
  const Stub = createRoutesStub([
    {
      path: "/settings/services",
      Component: () => (
        <ServiceFields
          fields={FIELDS}
          templates={TEMPLATES}
          otherServices={otherServices}
          initialTemplateId={initialTemplateId}
        />
      ),
    },
  ]);
  render(<Stub initialEntries={["/settings/services"]} />);
  return screen.getByLabelText(/template/i) as HTMLSelectElement;
}

describe("service template picker — the duplicate-report trap", () => {
  it("names the service already using the template", async () => {
    const select = renderFields([OTHERS[0], OTHERS[2]]);
    fireEvent.change(select, { target: { value: "tpl-residential" } });

    expect(await screen.findByText(/Standard Home Inspection also uses this template/i))
      .toBeTruthy();
  });

  it("says what it will cost them, in reports rather than in jargon", async () => {
    const select = renderFields([OTHERS[0], OTHERS[2]]);
    fireEvent.change(select, { target: { value: "tpl-residential" } });

    expect(await screen.findByText(/two identical reports/i)).toBeTruthy();
  });

  it("counts the rest when more than one service shares it", async () => {
    const select = renderFields();
    fireEvent.change(select, { target: { value: "tpl-residential" } });

    const msg = await screen.findByText(/use this template too/i);
    expect(msg.textContent).toContain("Standard Home Inspection");
    // "and 1 others" was the bug this phrasing avoids — same shape as
    // "Delete 1 comments?". "1 more" and "3 more" both read correctly.
    expect(msg.textContent).toContain("1 more");
    expect(msg.textContent).not.toMatch(/1 others/);
  });

  it("stays quiet when the template is unique to this service", async () => {
    const select = renderFields();
    fireEvent.change(select, { target: { value: "tpl-sewer" } });
    // Sewer Scope is in OTHERS, so pick a template nobody else uses instead.
    fireEvent.change(select, { target: { value: "tpl-residential" } });
    fireEvent.change(select, { target: { value: "" } });

    expect(screen.queryByText(/uses? this template/i)).toBeNull();
  });

  it("warns without blocking — the select keeps the value", async () => {
    const select = renderFields([OTHERS[0]]);
    fireEvent.change(select, { target: { value: "tpl-residential" } });

    await screen.findByText(/also uses this template/i);
    expect(select.value).toBe("tpl-residential");
  });

  it("does not warn about the service being edited itself", async () => {
    // The edit form filters the current service out before passing the rest;
    // without that a tenant editing a service would be warned about itself.
    const select = renderFields([], "tpl-residential");
    expect(select.value).toBe("tpl-residential");
    expect(screen.queryByText(/uses? this template/i)).toBeNull();
  });
});
