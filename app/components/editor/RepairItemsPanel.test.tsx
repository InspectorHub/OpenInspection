// @vitest-environment happy-dom
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, beforeEach, afterEach } from "vitest";
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

const CATALOG_ENDPOINT = "/resources/repair-items";

/** One catalogue entry, shaped as the resource route returns it. */
const OPTION = {
  id: "ri-1",
  name: "Reattach gutter",
  category: "Roof",
  defaultRepairSummary: "Reattach the loose gutter run and re-pitch to the downspout.",
  contractorTypeName: "Licensed Roofer",
};

function mockCatalog(items: unknown[]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).startsWith(CATALOG_ENDPOINT)) {
      return { ok: true, json: async () => ({ items }) } as Response;
    }
    throw new Error(`unexpected fetch: ${String(input)}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  mockCatalog([OPTION]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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
  vi.unstubAllGlobals();
  mockCatalog([{ ...OPTION, defaultEstimateMin: 15000, defaultEstimateMax: 40000 }]);

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
