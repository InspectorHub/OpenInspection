// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// useStructureEdit's only react-router dependency is useFetcher; stub it so the
// hook renders without a data-router provider. The itemImpact tally is pure
// state math and never touches the fetcher.
vi.mock("react-router", () => ({
  useFetcher: () => ({ submit: vi.fn(), state: "idle", data: undefined }),
}));

import { useStructureEdit } from "~/hooks/useStructureEdit";

const snapshot = {
  sections: [{ id: "s1", title: "Section 1", items: [{ id: "i1", label: "Item 1", type: "rich" }] }],
};

describe("useStructureEdit — Phase U itemImpact scoping", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads the _default finding when no unit is active (byte-identical)", () => {
    const results = {
      "_default:s1:i1": { rating: "x", notes: "hi", photos: [{}, {}] },
    };
    const { result } = renderHook(() =>
      useStructureEdit({ rawSnapshot: snapshot, collabEditing: false, results }),
    );
    act(() => result.current.deleteItem("s1", "i1"));
    expect(result.current.deletePending?.impact).toEqual({ items: 1, ratings: 1, notes: 1, photos: 2 });
  });

  it("falls back to the bare itemId slot in the common view (activeUnitId null)", () => {
    const results = { i1: { rating: "x", notes: "", photos: [{}] } };
    const { result } = renderHook(() =>
      useStructureEdit({ rawSnapshot: snapshot, collabEditing: false, results }),
    );
    act(() => result.current.deleteItem("s1", "i1"));
    expect(result.current.deletePending?.impact).toEqual({ items: 1, ratings: 1, notes: 0, photos: 1 });
  });

  it("reads ONLY the active unit's finding — never the ambiguous _default/bare slot", () => {
    const results = {
      "u1:s1:i1": { rating: "x", notes: "hi", photos: [{}] },
      // Decoys that MUST NOT contribute once a unit is active.
      "_default:s1:i1": { rating: "y", notes: "other", photos: [{}, {}, {}] },
      i1: { rating: "z", notes: "bare", photos: [{}, {}, {}, {}] },
    };
    const { result } = renderHook(() =>
      useStructureEdit({ rawSnapshot: snapshot, collabEditing: false, results, activeUnitId: "u1" }),
    );
    act(() => result.current.deleteItem("s1", "i1"));
    // photos:1 (u1's), not 3 (_default) or 4 (bare) — proves the scope.
    expect(result.current.deletePending?.impact).toEqual({ items: 1, ratings: 1, notes: 1, photos: 1 });
  });

  it("reports an empty impact for an unseeded active-unit finding (no bare fallback)", () => {
    const results = {
      // Only a bare + _default entry exist; the active unit u1 has none.
      i1: { rating: "z", notes: "bare", photos: [{}, {}] },
      "_default:s1:i1": { rating: "y", notes: "d", photos: [{}] },
    };
    const { result } = renderHook(() =>
      useStructureEdit({ rawSnapshot: snapshot, collabEditing: false, results, activeUnitId: "u1" }),
    );
    act(() => result.current.deleteItem("s1", "i1"));
    expect(result.current.deletePending?.impact).toEqual({ items: 1, ratings: 0, notes: 0, photos: 0 });
  });

  it("counts the WHOLE SUBTREE, because that is what the delete removes", () => {
    // deleteItem takes an item's descendants with it. A modal that says
    // "1 item" while three go, and tallies only the parent's photos, is not a
    // confirmation -- it is a wrong number the inspector is asked to approve.
    const nested = {
      sections: [{
        id: "s1", title: "Roof",
        items: [
          { id: "i1", label: "Sealed Roof Deck", type: "rich" },
          { id: "i1a", label: "Fully adhered", type: "rich", parentId: "i1" },
          { id: "i1b", label: "entire underside", type: "rich", parentId: "i1a" },
        ],
      }],
    };
    const results = {
      "_default:s1:i1": { rating: "x", notes: "", photos: [{}] },
      "_default:s1:i1a": { rating: "x", notes: "hi", photos: [{}, {}] },
      "_default:s1:i1b": { rating: "", notes: "", photos: [] },
    };
    const { result } = renderHook(() =>
      useStructureEdit({ rawSnapshot: nested, collabEditing: false, results }),
    );
    act(() => result.current.deleteItem("s1", "i1"));
    expect(result.current.deletePending?.impact).toEqual({ items: 3, ratings: 2, notes: 1, photos: 3 });
  });

  it("still counts exactly one for a leaf", () => {
    // Positive control for the subtree tally: a version that counted the whole
    // SECTION would pass the assertion above.
    const nested = {
      sections: [{
        id: "s1", title: "Roof",
        items: [
          { id: "i1", label: "Sealed Roof Deck", type: "rich" },
          { id: "i1a", label: "Fully adhered", type: "rich", parentId: "i1" },
        ],
      }],
    };
    const { result } = renderHook(() =>
      useStructureEdit({ rawSnapshot: nested, collabEditing: false, results: {} }),
    );
    act(() => result.current.deleteItem("s1", "i1a"));
    expect(result.current.deletePending?.impact.items).toBe(1);
  });
});
