// @vitest-environment happy-dom
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import type { ReactElement } from "react";
import { FieldDataSourceProvider } from "../../context";
import type { RepairItemOption } from "../../data-source-types";
import { createEmptyEditorData, createFakeDataSource, createFakeRepairItems } from "../../testing/fake-data-source";
import { RepairItemsPanel } from "./RepairItemsPanel";

/**
 * Attaching a repair item snapshots the SCOPE of the work onto the finding —
 * what needs doing and which trade does it. It does not snapshot a price.
 *
 * The product stores what an inspection observes (category, severity,
 * description). Money on an inspection is written by the buyer or their agent
 * in the repair request; a figure the product carries into the report reads as
 * the inspection company's number, which is not something a catalogue default
 * can be.
 *
 * These tests assert on the snapshot the panel HANDS TO THE EDITOR, because
 * that object is what gets persisted into `inspection_results.data` and read
 * back by the report. Asserting only on what the panel renders would pass
 * while a price rode along invisibly in the payload.
 */

/** One catalogue entry, shaped as the resource answers it. */
const OPTION: RepairItemOption = {
  id: "ri-1",
  name: "Reattach gutter",
  category: "Roof",
  defaultRepairSummary: "Reattach the loose gutter run and re-pitch to the downspout.",
  contractorTypeName: "Licensed Roofer",
};

let catalog = createFakeRepairItems([OPTION]);

/** Render on a provider whose `repairItems` resource is `catalog`. */
function render(ui: ReactElement) {
  const fake = createFakeDataSource({ data: createEmptyEditorData(), resources: { repairItems: catalog } });
  return rtlRender(<FieldDataSourceProvider dataSource={fake}>{ui}</FieldDataSourceProvider>);
}

beforeEach(() => {
  catalog = createFakeRepairItems([OPTION]);
});

async function attachTheOnlyItem() {
  const onAttach = vi.fn();
  render(<RepairItemsPanel attached={[]} onAttach={onAttach} onDetach={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: /attach/i }));
  const option = await screen.findByRole("option", { name: /Reattach gutter/i });
  fireEvent.click(option.querySelector("button")!);
  await waitFor(() => expect(onAttach).toHaveBeenCalledTimes(1));
  return onAttach.mock.calls[0]![0] as Record<string, unknown>;
}

test("the attached snapshot carries scope and trade, and no money key at all", async () => {
  const snap = await attachTheOnlyItem();

  // Positive control: the snapshot is not empty, so "no money" is a real
  // finding rather than "nothing was attached".
  expect(snap.recommendationId).toBe("ri-1");
  expect(snap.summarySnapshot).toBe(OPTION.defaultRepairSummary);
  expect(snap.contractorTypeSnapshot).toBe("Licensed Roofer");

  // A key set to `null` is still a price field the next reader will fill in.
  // Assert on the KEY SET, not on the values.
  const moneyKeys = Object.keys(snap).filter((k) =>
    /estimate|price|cost|amount|cents/i.test(k),
  );
  expect(moneyKeys).toEqual([]);
});

test("a catalogue entry that still carries a price cannot smuggle it onto the finding", async () => {
  // A tenant catalogue row, an older API build, or a hand-crafted response may
  // still contain estimate fields. The panel must not relay them.
  catalog = createFakeRepairItems([{ ...OPTION, defaultEstimateMin: 15000, defaultEstimateMax: 40000 } as RepairItemOption]);

  const snap = await attachTheOnlyItem();
  expect(Object.keys(snap)).not.toContain("estimateSnapshotMin");
  expect(Object.keys(snap)).not.toContain("estimateSnapshotMax");
  expect(JSON.stringify(snap)).not.toContain("15000");
  expect(JSON.stringify(snap)).not.toContain("40000");
});

test("an already-attached legacy snapshot renders its scope without printing a price", async () => {
  // Findings written before repair pricing was removed still hold the keys.
  // The panel reads them back; it must not render the money.
  render(
    <RepairItemsPanel
      attached={[
        {
          recommendationId: "ri-legacy",
          summarySnapshot: "Replace the breaker",
          contractorTypeSnapshot: "Licensed Electrician",
          attachedAt: 1,
          // Legacy keys, deliberately present in the persisted JSON.
          estimateSnapshotMin: 15000,
          estimateSnapshotMax: 40000,
        } as never,
      ]}
      onAttach={() => {}}
      onDetach={() => {}}
    />,
  );

  expect(screen.getByText("Replace the breaker")).toBeTruthy();
  expect(screen.queryByText(/\$150/)).toBeNull();
  expect(screen.queryByText(/\$400/)).toBeNull();
});

test("reads the catalogue once on mount, and offers nothing to attach on a host without one", async () => {
  render(<RepairItemsPanel attached={[]} onAttach={() => {}} onDetach={() => {}} />);
  await waitFor(() => expect(catalog.lists).toBe(1));

  const bare = createFakeDataSource({ data: createEmptyEditorData() });
  rtlRender(
    <FieldDataSourceProvider dataSource={bare}>
      <RepairItemsPanel attached={[]} onAttach={() => {}} onDetach={() => {}} />
    </FieldDataSourceProvider>,
  );
  const buttons = screen.getAllByRole("button", { name: /attach/i });
  fireEvent.click(buttons[buttons.length - 1]!);
  expect(await screen.findByText(/No matching repair items/)).toBeTruthy();
});
