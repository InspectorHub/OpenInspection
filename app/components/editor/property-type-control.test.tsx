// @vitest-environment happy-dom
/**
 * The property-type selector, and the one thing about it that is not a plain save.
 *
 * Reclassifying an inspection AWAY from commercial closes four readers at once:
 * the report tier, the ASTM PCA block, the Building Profile preset and the
 * editor's own units surface. Nothing is deleted — the server specs in
 * `tests/unit/inspections/inspection-reclassify-property-type.spec.ts` pin that —
 * but the work already recorded behind those gates stops being visible, and the
 * inspector has to be told before it happens rather than after.
 *
 * So the assertions that earn their place are asymmetric on purpose:
 *   - arriving AT commercial opens surfaces and loses nothing -> writes straight through;
 *   - leaving commercial -> a DS modal first, and NO write until it is confirmed.
 *
 * `window.confirm` is forbidden in this codebase; the modal is the shared DS one,
 * mirroring the lossy per_unit → tagged switch in UnitsManager.
 */
import { describe, it, expect } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import { PropertyTypeControl } from "~/components/editor/PropertyTypeControl";
import { IDEMPOTENCY_FIELD } from "~/hooks/useGuardedSubmit";

type Props = Parameters<typeof PropertyTypeControl>[0];

const COMMERCIAL: Props = {
  inspectionId: "insp-1",
  propertyType: "commercial",
  commercialSubtype: "office",
  reportTier: "full_pca",
  perUnitMode: true,
  hasPcaNarrative: true,
};

function renderControl(props: Partial<Props> = {}, costItems = [{ id: "c1" }, { id: "c2" }]) {
  const calls: Record<string, string>[] = [];
  const Stub = createRoutesStub([
    {
      path: "/edit",
      Component: () => <PropertyTypeControl {...COMMERCIAL} {...props} />,
      action: async ({ request }) => {
        const form = await request.formData();
        calls.push(Object.fromEntries(form) as Record<string, string>);
        return { ok: true };
      },
    },
    // The control loads the cost-item count through the real BFF resource route
    // path (never a client fetch to /api/...), so the stub answers that address.
    { path: "/resources/cost-items", loader: () => ({ items: costItems }) },
  ]);
  const utils = render(<Stub initialEntries={["/edit"]} />);
  return { ...utils, calls };
}

/**
 * The payload minus the idempotency key the guard mints per submit.
 *
 * Deleted from a copy rather than destructured away: a rest-sibling omission
 * needs a binding for the key it discards, and an unused binding is an error
 * here rather than a warning.
 */
function payloadOf(call: Record<string, string>) {
  const rest = { ...call };
  delete rest[IDEMPOTENCY_FIELD];
  return rest;
}

describe("PropertyTypeControl", () => {
  it("offers every canonical type plus an unclassified option", async () => {
    const { findByTestId } = renderControl();
    const select = (await findByTestId("property-type-select")) as unknown as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["", "single_family", "multi_unit", "commercial"]);
    expect(select.value).toBe("commercial");
  });

  it("renders for an UNCLASSIFIED inspection — the case it exists for", async () => {
    // Every row created before intake captured the field is null here. A control
    // gated on `propertyType === 'commercial'`, like its neighbours, could never
    // be the thing that classifies one.
    const { findByTestId } = renderControl({ propertyType: null });
    expect(((await findByTestId("property-type-select")) as unknown as HTMLSelectElement).value).toBe("");
  });

  it("writes straight through when ARRIVING at commercial", async () => {
    const { findByTestId, calls } = renderControl({
      propertyType: null, commercialSubtype: null, reportTier: null,
      perUnitMode: false, hasPcaNarrative: false,
    });
    fireEvent.change(await findByTestId("property-type-select"), { target: { value: "commercial" } });

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(payloadOf(calls[0])).toEqual({
      intent: "save-settings",
      payload: JSON.stringify({ propertyType: "commercial" }),
    });
  });

  it("asks FIRST when leaving commercial, and writes nothing until confirmed", async () => {
    const { findByTestId, findByText, calls } = renderControl();
    fireEvent.change(await findByTestId("property-type-select"), { target: { value: "single_family" } });

    // The warning is up...
    expect(await findByText(/Reclassify away from commercial\?/i)).toBeTruthy();
    // ...and nothing has been written.
    expect(calls, "a reclassification must not land before the inspector agrees").toHaveLength(0);

    fireEvent.click(await findByTestId("property-type-confirm"));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(payloadOf(calls[0])).toEqual({
      intent: "save-settings",
      payload: JSON.stringify({ propertyType: "single_family" }),
    });
  });

  it("cancelling writes nothing at all", async () => {
    const { findByTestId, findByText, calls } = renderControl();
    fireEvent.change(await findByTestId("property-type-select"), { target: { value: "multi_unit" } });
    fireEvent.click(await findByText("Cancel"));
    await waitFor(() => expect(calls).toHaveLength(0));
  });

  it("names the opinion-of-cost lines it is about to hide, with their real count", async () => {
    const { findByTestId } = renderControl();
    fireEvent.change(await findByTestId("property-type-select"), { target: { value: "single_family" } });
    // Counted from the resource route, not guessed: money already entered is the
    // number the inspector needs before agreeing.
    expect((await findByTestId("lossy-cost-items")).textContent).toMatch(/2 opinion-of-cost lines/);
  });

  it("says nothing about cost lines when there are none", async () => {
    const { findByTestId, queryByTestId, findByText } = renderControl({}, []);
    fireEvent.change(await findByTestId("property-type-select"), { target: { value: "single_family" } });
    await findByText(/Reclassify away from commercial\?/i);
    // Naming an empty category teaches the reader to skim the next warning.
    await waitFor(() => expect(queryByTestId("lossy-cost-items")).toBeNull());
  });

  /**
   * The asymmetry found while auditing this: the report prints its per-unit
   * payload from `unit_inspection_mode`, which reclassifying does not touch, while
   * the editor's unit switcher is gated on the property type and closes. So those
   * findings stay on the report and lose their editor — a different outcome from
   * the cost lines, and the warning has to say so rather than lump them together.
   */
  it("warns separately that per-unit findings stay on the report but lose their editor", async () => {
    const { findByTestId } = renderControl();
    fireEvent.change(await findByTestId("property-type-select"), { target: { value: "single_family" } });
    const text = (await findByTestId("lossy-units")).textContent ?? "";
    expect(text).toMatch(/keep appearing/i);
    expect(text).toMatch(/unit switcher closes/i);
  });

  it("omits the per-unit warning when the inspection is not in per-unit mode", async () => {
    const { findByTestId, queryByTestId, findByText } = renderControl({ perUnitMode: false });
    fireEvent.change(await findByTestId("property-type-select"), { target: { value: "single_family" } });
    await findByText(/Reclassify away from commercial\?/i);
    await waitFor(() => expect(queryByTestId("lossy-units")).toBeNull());
  });

  it("promises reversibility, because the server actually delivers it", async () => {
    const { findByTestId, findByText } = renderControl();
    fireEvent.change(await findByTestId("property-type-select"), { target: { value: "single_family" } });
    expect(await findByText(/Nothing is deleted\./i)).toBeTruthy();
  });

  it("sends null, not an empty string, when clearing the classification", async () => {
    // The settings sanitizer drops '' as "field unchanged", so an empty string
    // would silently fail to clear anything.
    const { findByTestId, calls } = renderControl();
    fireEvent.change(await findByTestId("property-type-select"), { target: { value: "" } });
    fireEvent.click(await findByTestId("property-type-confirm"));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(payloadOf(calls[0]).payload).toBe(JSON.stringify({ propertyType: null }));
  });

  it("re-picking the current value does nothing", async () => {
    const { findByTestId, calls } = renderControl();
    fireEvent.change(await findByTestId("property-type-select"), { target: { value: "commercial" } });
    await waitFor(() => expect(calls).toHaveLength(0));
  });
});
