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
 *
 * The control writes the data source's `save-settings` command and reads the cost-line count
 * from its `costItems` resource, so these tests run it on the provider and a fake data source
 * and assert on the COMMANDS it issued. The form post those commands become is pinned by the
 * web adapter tests (app/lib/field/web-command-encode).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import { FieldDataSourceProvider } from "../../context";
import type { FieldResources } from "../../data-source";
import type { CostItemView } from "../../data-source-types";
import { createEmptyEditorData, createFakeCostItems, createFakeDataSource } from "../../testing/fake-data-source";
import type { FakeDataSource } from "../../testing/fake-data-source";
import { PropertyTypeControl } from "./PropertyTypeControl";

afterEach(cleanup);

type Props = Parameters<typeof PropertyTypeControl>[0];

const COMMERCIAL: Props = {
  inspectionId: "insp-1",
  propertyType: "commercial",
  commercialSubtype: "office",
  reportTier: "full_pca",
  perUnitMode: true,
  hasPcaNarrative: true,
  onSaved: () => undefined,
};

const line = (id: string) => ({ id }) as CostItemView;
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

function renderControl(props: Partial<Props> = {}, items: CostItemView[] = [line("c1"), line("c2")], resources?: FieldResources) {
  const fake: FakeDataSource = createFakeDataSource({
    data: createEmptyEditorData(),
    resources: resources ?? { costItems: createFakeCostItems(items) },
  });
  const utils = render(
    <FieldDataSourceProvider dataSource={fake}>
      <PropertyTypeControl {...COMMERCIAL} {...props} />
    </FieldDataSourceProvider>,
  );
  return { ...utils, fake };
}

/** The commands the control issued, as a plain list. */
const sent = (fake: FakeDataSource) => fake.commands.map((c) => c.cmd);

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
    const { findByTestId, fake } = renderControl({
      propertyType: null, commercialSubtype: null, reportTier: null,
      perUnitMode: false, hasPcaNarrative: false,
    });
    fireEvent.change(await findByTestId("property-type-select"), { target: { value: "commercial" } });

    await waitFor(() => expect(fake.commands).toHaveLength(1));
    expect(fake.commands[0]).toMatchObject({
      inspectionId: "insp-1",
      cmd: { type: "save-settings", payload: { propertyType: "commercial" } },
    });
    // The idempotency key travels with it (the guard mints it).
    expect(typeof fake.commands[0]!.idempotencyKey).toBe("string");
  });

  it("asks FIRST when leaving commercial, and writes nothing until confirmed", async () => {
    const { findByTestId, findByText, fake } = renderControl();
    fireEvent.change(await findByTestId("property-type-select"), { target: { value: "single_family" } });

    // The warning is up...
    expect(await findByText(/Reclassify away from commercial\?/i)).toBeTruthy();
    // ...and nothing has been written.
    expect(fake.commands, "a reclassification must not land before the inspector agrees").toHaveLength(0);

    fireEvent.click(await findByTestId("property-type-confirm"));
    await waitFor(() => expect(fake.commands).toHaveLength(1));
    expect(sent(fake)[0]).toEqual({ type: "save-settings", payload: { propertyType: "single_family" } });
  });

  it("keeps focus on the select while saving: aria-disabled, not native, and a second change is ignored", async () => {
    // The write never settles, so the control stays busy for the whole assertion.
    const { findByTestId, fake } = renderControl({
      propertyType: "single_family", commercialSubtype: null, reportTier: null, perUnitMode: false, hasPcaNarrative: false,
    });
    vi.spyOn(fake, "execute").mockImplementation((() => new Promise(() => {})) as FakeDataSource["execute"]);
    const select = (await findByTestId("property-type-select")) as unknown as HTMLSelectElement;
    select.focus();
    fireEvent.change(select, { target: { value: "multi_unit" } });
    await waitFor(() => expect(select.getAttribute("aria-disabled")).toBe("true"));
    expect(select.disabled).toBe(false);
    expect(document.activeElement).toBe(select);

    fireEvent.change(select, { target: { value: "commercial" } });
    expect(vi.mocked(fake.execute), "a change while the save is in flight must be ignored").toHaveBeenCalledTimes(1);
  });

  it("cancelling writes nothing at all", async () => {
    const { findByTestId, findByText, fake } = renderControl();
    fireEvent.change(await findByTestId("property-type-select"), { target: { value: "multi_unit" } });
    fireEvent.click(await findByText("Cancel"));
    await settle();
    expect(fake.commands).toHaveLength(0);
  });

  it("names the opinion-of-cost lines it is about to hide, with their real count", async () => {
    const { findByTestId, fake } = renderControl();
    fireEvent.change(await findByTestId("property-type-select"), { target: { value: "single_family" } });
    // Counted from the host's cost-items read, not guessed: money already entered is the
    // number the inspector needs before agreeing.
    expect((await findByTestId("lossy-cost-items")).textContent).toMatch(/2 opinion-of-cost lines/);
    expect((fake.resources.costItems as ReturnType<typeof createFakeCostItems>).lists).toEqual(["insp-1"]);
  });

  it("says it is checking until the read answers", async () => {
    let answer: (listing: { items: CostItemView[]; reserveEnabled: boolean }) => void = () => undefined;
    const costItems: NonNullable<FieldResources["costItems"]> = {
      list: () => new Promise((resolve) => { answer = resolve; }),
      save: async () => ({ ok: true }),
    };
    const { findByTestId, findByText } = renderControl({}, [], { costItems });
    fireEvent.change(await findByTestId("property-type-select"), { target: { value: "single_family" } });
    expect(await findByText(/checking for opinion-of-cost lines/i)).toBeTruthy();
    answer({ items: [line("c1")], reserveEnabled: false });
    expect((await findByTestId("lossy-cost-items")).textContent).toMatch(/1 opinion-of-cost line/);
  });

  it("says nothing about cost lines when there are none", async () => {
    const { findByTestId, queryByTestId, findByText } = renderControl({}, []);
    fireEvent.change(await findByTestId("property-type-select"), { target: { value: "single_family" } });
    await findByText(/Reclassify away from commercial\?/i);
    // Naming an empty category teaches the reader to skim the next warning.
    await waitFor(() => expect(queryByTestId("lossy-cost-items")).toBeNull());
  });

  it("shows no cost line, and does not wait for one, when the host has no cost-items read", async () => {
    const { findByTestId, queryByTestId, queryByText, findByText } = renderControl({}, [], {});
    fireEvent.change(await findByTestId("property-type-select"), { target: { value: "single_family" } });
    await findByText(/Reclassify away from commercial\?/i);
    expect(queryByTestId("lossy-cost-items")).toBeNull();
    expect(queryByText(/checking for opinion-of-cost lines/i)).toBeNull();
  });

  it("a newer count replaces an older one that answers late", async () => {
    // Open, cancel, open again: the first read answers AFTER the second, and must not win.
    const answers: Array<(listing: { items: CostItemView[]; reserveEnabled: boolean }) => void> = [];
    const costItems: NonNullable<FieldResources["costItems"]> = {
      list: () => new Promise((resolve) => { answers.push(resolve); }),
      save: async () => ({ ok: true }),
    };
    const { findByTestId, findByText } = renderControl({}, [], { costItems });
    const select = await findByTestId("property-type-select");
    fireEvent.change(select, { target: { value: "single_family" } });
    fireEvent.click(await findByText("Cancel"));
    fireEvent.change(select, { target: { value: "multi_unit" } });
    await waitFor(() => expect(answers).toHaveLength(2));
    await act(async () => { answers[1]!({ items: [line("a"), line("b")], reserveEnabled: false }); });
    await act(async () => { answers[0]!({ items: [line("x"), line("y"), line("z"), line("w"), line("v")], reserveEnabled: false }); });
    expect((await findByTestId("lossy-cost-items")).textContent).toMatch(/2 opinion-of-cost lines/);
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
    const { findByTestId, fake } = renderControl();
    fireEvent.change(await findByTestId("property-type-select"), { target: { value: "" } });
    fireEvent.click(await findByTestId("property-type-confirm"));
    await waitFor(() => expect(fake.commands).toHaveLength(1));
    const cmd = sent(fake)[0] as unknown as { payload: { propertyType: unknown } };
    expect(cmd.payload.propertyType).toBeNull();
  });

  it("re-picking the current value does nothing", async () => {
    const { findByTestId, fake } = renderControl();
    fireEvent.change(await findByTestId("property-type-select"), { target: { value: "commercial" } });
    await settle();
    expect(fake.commands).toHaveLength(0);
  });
});

// Reclassifying is a write the report readers branch on: two presses of the confirm button in ONE frame
// must send ONE command. The pending button only goes inert after a render, too late for the second press.
describe("PropertyTypeControl same-frame guard", () => {
  it("sends ONE command for two same-frame presses of the confirm button", async () => {
    const { findByTestId, fake } = renderControl();
    fireEvent.change(await findByTestId("property-type-select"), { target: { value: "single_family" } });
    const confirm = await findByTestId("property-type-confirm");
    act(() => { confirm.click(); confirm.click(); });
    await settle();
    expect(fake.commands).toHaveLength(1);
  });

  it("CONTROL - a later press goes through after the first settles", async () => {
    const { findByTestId, fake } = renderControl({ propertyType: "single_family", commercialSubtype: null, reportTier: null, perUnitMode: false, hasPcaNarrative: false });
    const select = await findByTestId("property-type-select");
    act(() => { fireEvent.change(select, { target: { value: "multi_unit" } }); });
    await settle();
    act(() => { fireEvent.change(select, { target: { value: "commercial" } }); });
    await settle();
    expect(fake.commands).toHaveLength(2);
  });
});
