import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useInspectionState, type InspectionSchema } from "~/hooks/useInspection";

/**
 * Phase U (Batch C2a) — the results pre-fill stub loop seeds per-unit stubs for
 * the active scope on top of the legacy `_default` + bare-itemId stubs. The
 * `_default` seeding is unchanged, so a null active scope is byte-identical to
 * before this change.
 */
const schema: InspectionSchema = {
  sections: [{ id: "s1", title: "S1", items: [{ id: "i1", label: "I1", type: "rich" }] }],
};
const inspection = { id: "insp-1" };

describe("useInspectionState — Phase U stub seeding", () => {
  it("seeds only _default + bare-itemId stubs when no unit is active (byte-identical)", () => {
    const { result } = renderHook(() =>
      useInspectionState({ inspection, schema, results: {} }),
    );
    expect(Object.keys(result.current.results).sort()).toEqual(["_default:s1:i1", "i1"]);
    expect(result.current.results["_default:s1:i1"]).toEqual({ rating: null, notes: "", photos: [] });
  });

  it("also seeds the active unit's scope when a unit is the initial active scope", () => {
    const { result } = renderHook(() =>
      useInspectionState({ inspection, schema, results: {}, activeUnitId: "u1" }),
    );
    expect(Object.keys(result.current.results).sort()).toEqual([
      "_default:s1:i1",
      "i1",
      "u1:s1:i1",
    ]);
    expect(result.current.results["u1:s1:i1"]).toEqual({ rating: null, notes: "", photos: [] });
  });

  it("does not clobber a pre-existing per-unit finding when seeding", () => {
    const { result } = renderHook(() =>
      useInspectionState({
        inspection,
        schema,
        results: { "u1:s1:i1": { rating: "good", notes: "n", photos: [] } },
        activeUnitId: "u1",
      }),
    );
    expect(result.current.results["u1:s1:i1"]).toEqual({ rating: "good", notes: "n", photos: [] });
  });
});
