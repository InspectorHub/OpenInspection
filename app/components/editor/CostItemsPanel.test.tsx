import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, beforeEach, afterEach } from "vitest";
import { CostItemsPanel } from "./CostItemsPanel";
import type { CostItemView } from "~/components/portal/sections/report/types";

describe("CostItemsPanel", () => {
  it("renders an empty-state add affordance with zero running totals", () => {
    const { getByText } = render(<CostItemsPanel inspectionId="i1" items={[]} reserveEnabled={false} />);
    expect(getByText(/Cost Items/i)).toBeTruthy();
    expect(getByText(/\$0/)).toBeTruthy(); // running total
  });

  describe("cost export control", () => {
    const oneItem: CostItemView[] = [
      {
        id: "a", system: "roof", component: "membrane", location: "",
        action: "replace", costMethod: "lump_sum",
        quantity: null, uom: null, unitCostCents: null, lumpSumCents: 500000,
        eul: null, effAge: null, rul: null,
        suggestedRemedy: "", bucket: "immediate",
        sectionRef: null, photoRef: null, sortOrder: 0,
      },
    ];

    it("hides the CSV/Excel export links when there are no cost items", () => {
      render(<CostItemsPanel inspectionId="i1" items={[]} reserveEnabled={false} />);
      expect(screen.queryByTestId("cost-export-panel")).toBeNull();
    });

    it("shows CSV + Excel links pointing at the /resources/cost-export relay once an item exists", () => {
      render(<CostItemsPanel inspectionId="insp-9" items={oneItem} reserveEnabled={false} />);
      const csv = screen.getByTestId("cost-export-csv") as HTMLAnchorElement;
      const xlsx = screen.getByTestId("cost-export-xlsx") as HTMLAnchorElement;
      expect(csv.getAttribute("href")).toBe("/resources/cost-export?inspectionId=insp-9&format=csv");
      expect(xlsx.getAttribute("href")).toBe("/resources/cost-export?inspectionId=insp-9&format=xlsx");
      expect(csv.hasAttribute("download")).toBe(true);
      expect(xlsx.hasAttribute("download")).toBe(true);
    });
  });

  it("shows a threshold warning for an under-$3k item", () => {
    const { getByText } = render(
      <CostItemsPanel
        inspectionId="i1"
        reserveEnabled={false}
        items={[
          {
            id: "a", system: "roof", component: "flashing", location: "",
            action: "repair", costMethod: "lump_sum",
            quantity: null, uom: null, unitCostCents: null, lumpSumCents: 100000,
            eul: null, effAge: null, rul: null,
            suggestedRemedy: "", bucket: "immediate",
            sectionRef: null, photoRef: null, sortOrder: 0,
          },
        ]}
      />,
    );
    expect(getByText(/below the \$3,000 threshold/i)).toBeTruthy();
  });

  // Fix wave (task-13b-report.md): the "add row" flow used to fire a
  // fire-and-forget `create` for a blank temp-id row without marking it
  // busy, so a field commit that landed before that create resolved would
  // see `isTempId(id) === true` and fire a SECOND `create` — a silent
  // duplicate cost row. These tests exercise the fix: the row's controls
  // are disabled for the lifetime of the pending create, and even a commit
  // that manages to land anyway is guarded off (defense-in-depth) rather
  // than issuing a duplicate `create`.
  describe("temp-id create race", () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("disables the new row's controls while its create is pending, and never issues a second create for it", async () => {
      let resolveCreate!: (v: { ok: boolean; json: () => Promise<unknown> }) => void;
      const createPromise = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => {
        resolveCreate = resolve;
      });
      fetchMock.mockReturnValueOnce(createPromise);

      render(<CostItemsPanel inspectionId="i1" items={[]} reserveEnabled={false} />);

      fireEvent.click(screen.getByText("+ Add cost item"));

      // The initial background create fired exactly once, synchronously.
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const systemInput = screen.getByPlaceholderText("e.g. roof") as HTMLInputElement;
      expect(systemInput.disabled).toBe(true);
      expect((screen.getByText("Remove") as HTMLButtonElement).disabled).toBe(true);

      // Even if a field edit manages to reach the commit handler while the
      // row is still pending (e.g. a blur that lands before React commits
      // the `disabled` attribute), the temp-id + pending-save guard in
      // `commitRow` must refuse to fire a second `create` for this row.
      fireEvent.change(systemInput, { target: { value: "roof" } });
      fireEvent.blur(systemInput);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Resolve the create: the temp id swaps to the real server id and the
      // row's controls re-enable.
      resolveCreate({ ok: true, json: async () => ({ success: true, id: "real-1" }) });
      await waitFor(() => {
        expect((screen.getByPlaceholderText("e.g. roof") as HTMLInputElement).disabled).toBe(false);
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // A subsequent edit now commits as an UPDATE against the real id —
      // never a second create.
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
      const settledInput = screen.getByPlaceholderText("e.g. roof") as HTMLInputElement;
      fireEvent.change(settledInput, { target: { value: "roof" } });
      fireEvent.blur(settledInput);

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      const [, updateInit] = fetchMock.mock.calls[1] as [string, { body: FormData }];
      expect(updateInit.body.get("intent")).toBe("update");
      expect(updateInit.body.get("itemId")).toBe("real-1");

      // Across the row's whole lifecycle, exactly one `create` was ever sent.
      const createCalls = fetchMock.mock.calls.filter(
        ([, init]) => (init as { body: FormData }).body.get("intent") === "create",
      );
      expect(createCalls).toHaveLength(1);
    });
  });
});
