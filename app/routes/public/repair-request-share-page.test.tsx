/**
 * IA-57 — the public repair-request page must show the recommended trade.
 *
 * The trade ("who should fix this") is captured per defect in the editor but
 * used to exist only as a Mustache variable inside the canned comment, so a
 * contractor reading the shared repair list had no way to see which trade the
 * inspector called for. A view-model test alone cannot prove the field reaches
 * a reader — this renders the actual page component and asserts on screen text.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import RepairRequestSharePage, {
  shareViewModel,
} from "./repair-request.$shareToken";

function renderShare(items: Parameters<typeof shareViewModel>[0]["items"]) {
  const vm = shareViewModel({ propertyAddress: "1 Main St", creditTotal: 0, items });
  const Stub = createRoutesStub([
    {
      path: "/repair-request/:shareToken",
      Component: RepairRequestSharePage,
      loader: () => ({ kind: "ok", vm }),
    },
  ]);
  return render(<Stub initialEntries={["/repair-request/tok"]} />);
}

const BASE = {
  sectionTitle: "Roof",
  itemLabel: "Shingles",
  commentSnapshot: "Several shingles are cracked.",
  requestedCreditCents: 50000,
  note: null,
};

describe("repair-request share page — recommended trade (IA-57)", () => {
  it("shows the snapshotted trade for an item that has one", async () => {
    const { findByText } = renderShare([
      { ...BASE, tradeSnapshot: "licensed roofer" },
    ]);
    expect(await findByText(/licensed roofer/)).toBeTruthy();
  });

  it("labels the trade rather than burying it in the comment prose", async () => {
    const { findByTestId } = renderShare([
      { ...BASE, tradeSnapshot: "licensed roofer" },
    ]);
    const cell = await findByTestId("share-row-trade");
    expect(cell.textContent).toContain("licensed roofer");
  });

  it("renders no trade line when the item has no trade snapshot", async () => {
    const { queryByTestId, findByText } = renderShare([{ ...BASE }]);
    // Wait for the page to paint before asserting an absence.
    expect(await findByText(/Several shingles are cracked\./)).toBeTruthy();
    expect(queryByTestId("share-row-trade")).toBeNull();
  });
});
