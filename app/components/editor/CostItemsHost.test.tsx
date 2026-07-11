import { render, screen, waitFor } from "@testing-library/react";
import { vi, beforeEach, afterEach } from "vitest";
import { CostItemsHost } from "./CostItemsHost";

// Final-review fix (task-14): `CostItemsHost` used to seed its fetched state
// to an "empty" sentinel and render `<CostItemsPanel>` unconditionally. Since
// `CostItemsPanel` does `useState(items)` (captured once, at mount) and
// `Drawer` unmounts/remounts the Panel on every open/close, the FIRST open of
// an inspection that already has cost items mounted the Panel before the
// fetch below resolved — so it froze on `items=[]` / `reserveEnabled=false`
// forever, hiding existing rows and the reserve (EUL/EFF AGE/RUL) fields.
// These tests reproduce that race with a deferred fetch mock (mirroring
// `CostItemsPanel.test.tsx`'s "temp-id create race" mock) and assert the
// Panel eventually shows the real, already-loaded data.
describe("CostItemsHost", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows existing cost items (and reserve fields) once the deferred fetch resolves on first open", async () => {
    let resolveFetch!: (v: { ok: boolean; json: () => Promise<unknown> }) => void;
    const fetchPromise = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => {
      resolveFetch = resolve;
    });
    fetchMock.mockReturnValueOnce(fetchPromise);

    render(<CostItemsHost open onClose={() => {}} inspectionId="insp-1" />);

    // While the fetch is in flight, the Panel must NOT be mounted yet — a
    // premature mount is exactly what froze it on stale/empty props before
    // the fix.
    expect(screen.queryByDisplayValue(/Roof membrane/i)).toBeNull();
    expect(screen.getByText(/Loading/i)).toBeTruthy();

    resolveFetch({
      ok: true,
      json: async () => ({
        items: [
          {
            id: "real-1", system: "roof", component: "Roof membrane", location: "",
            action: "repair", costMethod: "lump_sum",
            quantity: null, uom: null, unitCostCents: null, lumpSumCents: 500000,
            eul: 20, effAge: 12, rul: 8,
            suggestedRemedy: "", bucket: "long_term",
            sectionRef: null, photoRef: null, sortOrder: 0,
          },
        ],
        reserveEnabled: true,
      }),
    });

    // Once the fetch resolves, the Panel mounts fresh with the REAL items —
    // this is the assertion that would fail under the pre-fix code (the
    // Panel would already be mounted on `items=[]` and never re-sync).
    await waitFor(() => expect(screen.getByDisplayValue("Roof membrane")).toBeTruthy());
    expect(screen.getByText(/EUL/i)).toBeTruthy();
    expect(screen.getByText(/RUL/i)).toBeTruthy();
  });

  it("still renders the Panel's empty state once a genuinely-empty fetch resolves", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ items: [], reserveEnabled: false }) });

    render(<CostItemsHost open onClose={() => {}} inspectionId="insp-2" />);

    await waitFor(() => expect(screen.getByText(/Nothing recorded yet/i)).toBeTruthy());
  });

  it("fails soft: a fetch error still renders the Panel (empty-but-loaded) rather than loading forever", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));

    render(<CostItemsHost open onClose={() => {}} inspectionId="insp-3" />);

    await waitFor(() => expect(screen.getByText(/Nothing recorded yet/i)).toBeTruthy());
  });
});
