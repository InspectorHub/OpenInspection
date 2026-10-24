// @vitest-environment happy-dom
/**
 * What happens after the property type is written. The editor keeps its own copy of the inspection (fixed at
 * mount), so an accepted save must patch it (`onSaved`) and ask the host to reload; before, the select snapped
 * back to the old type and the lossy dialog never closed until a manual reload. A refused save is reported.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import { FieldDataSourceProvider } from "../../context";
import { createEmptyEditorData, createFakeCostItems, createFakeDataSource } from "../../testing/fake-data-source";
import { PropertyTypeControl } from "./PropertyTypeControl";

afterEach(cleanup);

/** The host's side: keeps the classification in state and patches it on `onSaved`, as the editor does. */
function Harness({ start, saved }: { start: string | null; saved: Array<string | null> }) {
  const [type, setType] = useState<string | null>(start);
  return (
    <PropertyTypeControl
      inspectionId="insp-1"
      propertyType={type}
      commercialSubtype={null}
      reportTier={null}
      perUnitMode={false}
      hasPcaNarrative={false}
      onSaved={(next) => { saved.push(next); setType(next); }}
    />
  );
}

function mount(start: string | null) {
  const fake = createFakeDataSource({ data: createEmptyEditorData(), resources: { costItems: createFakeCostItems([]) } });
  const saved: Array<string | null> = [];
  const utils = render(
    <FieldDataSourceProvider dataSource={fake}>
      <Harness start={start} saved={saved} />
    </FieldDataSourceProvider>,
  );
  return { ...utils, fake, saved };
}
const select = (u: ReturnType<typeof mount>) => u.getByTestId("property-type-select") as unknown as HTMLSelectElement;
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

describe("PropertyTypeControl after a save", () => {
  it("an accepted save keeps the new type in the select, reports it, and asks the host to reload", async () => {
    const u = mount("single_family");
    fireEvent.change(select(u), { target: { value: "commercial" } });
    await waitFor(() => expect(u.saved).toEqual(["commercial"]));
    expect(select(u).value).toBe("commercial");
    expect(u.fake.reloadCount).toBe(1);
  });

  it("leaving commercial: the confirm closes by itself once the save is accepted", async () => {
    const u = mount("commercial");
    fireEvent.change(select(u), { target: { value: "single_family" } });
    fireEvent.click(await u.findByTestId("property-type-confirm"));
    await waitFor(() => expect(u.queryByTestId("property-type-confirm")).toBeNull());
    expect(u.saved).toEqual(["single_family"]);
    expect(select(u).value).toBe("single_family");
    expect(u.fake.reloadCount).toBe(1);
  });

  it("clearing the classification reports null", async () => {
    const u = mount("single_family");
    fireEvent.change(select(u), { target: { value: "" } });
    await waitFor(() => expect(u.saved).toEqual([null]));
  });

  it("a refused save says so, does not patch the editor and does not reload", async () => {
    const u = mount("single_family");
    u.fake.failExecute("save-settings", "Nope");
    fireEvent.change(select(u), { target: { value: "multi_unit" } });
    await waitFor(() => expect(u.fake.notifications).toEqual([{ message: "Nope", variant: "error" }]));
    expect(u.saved).toEqual([]);
    expect(u.fake.reloadCount).toBe(0);
    expect(select(u).value).toBe("single_family");
  });

  it("a refusal without a sentence still says something", async () => {
    const u = mount("single_family");
    u.fake.failExecute("save-settings", "");
    fireEvent.change(select(u), { target: { value: "multi_unit" } });
    await waitFor(() => expect(u.fake.notifications).toHaveLength(1));
    expect(u.fake.notifications[0]!.message).toMatch(/property type/i);
  });

  it("two same-frame presses of the confirm button report and reload once", async () => {
    const u = mount("commercial");
    fireEvent.change(select(u), { target: { value: "single_family" } });
    const confirm = await u.findByTestId("property-type-confirm");
    act(() => { confirm.click(); confirm.click(); });
    await settle();
    expect(u.fake.commands).toHaveLength(1);
    expect(u.saved).toEqual(["single_family"]);
    expect(u.fake.reloadCount).toBe(1);
    // The same-frame repeat left nothing behind: the select works again once the save has settled.
    fireEvent.change(select(u), { target: { value: "commercial" } });
    await waitFor(() => expect(u.fake.commands).toHaveLength(2));
    await waitFor(() => expect(u.saved).toEqual(["single_family", "commercial"]));
  });
});
