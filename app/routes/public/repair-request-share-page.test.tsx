// @vitest-environment happy-dom
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

describe("repair-request share page — requested action tag (#275)", () => {
  it("shows the buyer's requested action, localized rather than as the raw enum", async () => {
    const { findByTestId } = renderShare([{ ...BASE, repairActionTag: "replace" }]);
    const cell = await findByTestId("share-row-action-tag");
    expect(cell.textContent).toContain("Replace");
    // The stored value is `replace`; a page rendering that verbatim would look
    // right in English and be untranslatable everywhere else.
    expect(cell.textContent).not.toContain("replace");
  });

  it("resolves every value in the vocabulary", async () => {
    // Whole-vocabulary rather than one sample: a missing case in the label
    // switch is exactly the shape that ships one broken word.
    for (const [tag, label] of [
      ["repair", "Repair"],
      ["replace", "Replace"],
      ["fund", "Fund"],
      ["other", "Other"],
    ] as const) {
      const { findByTestId, unmount } = renderShare([{ ...BASE, repairActionTag: tag }]);
      expect((await findByTestId("share-row-action-tag")).textContent).toContain(label);
      unmount();
    }
  });

  it("renders no tag line for an untagged item — every pre-#275 row is one", async () => {
    const { queryByTestId, findByText } = renderShare([{ ...BASE }]);
    expect(await findByText(/Several shingles are cracked\./)).toBeTruthy();
    expect(queryByTestId("share-row-action-tag")).toBeNull();
  });

  it("sits OUTSIDE every print-hidden region, so it reaches the PDF", async () => {
    // The PDF is this page re-rendered through the print stylesheet
    // (sharePdfRoute -> generatePdfFromUrl). The footer is `print:hidden` and is
    // absent from the file the seller receives; that already happened once to
    // the amount attribution, which is why it carries the same assertion.
    const { findByTestId } = renderShare([{ ...BASE, repairActionTag: "fund" }]);
    const el = await findByTestId("share-row-action-tag");
    for (let node: HTMLElement | null = el; node; node = node.parentElement) {
      expect(node.className ?? "").not.toContain("print:hidden");
    }
  });

  it("keeps the tag out of the inspector-authored Finding cell", async () => {
    // Authorship, not layout: the Finding cell holds the defect title, comment
    // and recommended trade, all written by the inspector. A seller reading
    // "Replace" in there reads it as the inspector's call, not the buyer's ask.
    const { findByTestId } = renderShare([
      { ...BASE, repairActionTag: "replace", tradeSnapshot: "licensed roofer" },
    ]);
    const tradeCell = await findByTestId("share-row-trade");
    const tagCell = await findByTestId("share-row-action-tag");
    expect(tradeCell.parentElement?.contains(tagCell)).toBe(false);
  });
});
