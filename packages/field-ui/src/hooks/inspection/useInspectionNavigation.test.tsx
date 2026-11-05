// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useInspectionNavigation } from "./useInspectionNavigation";
import type { InspectionContext } from "./helpers";

/** Two items in one section; the first is the active one and the second has no rating yet. */
function makeCtx(setActiveItemId: (id: string | null) => void): InspectionContext {
  const items = [{ id: "i1" }, { id: "i2" }];
  const section = { id: "s1", title: "Roof", items };
  return {
    sections: [section],
    currentSection: section,
    currentSectionItems: items,
    currentSectionIdx: 0,
    setCurrentSectionIdx: vi.fn(),
    activeItemId: "i1",
    setActiveItemId,
    setActiveView: vi.fn(),
    setBatchMode: vi.fn(),
    setBatchSelected: vi.fn(),
    getResult: (id: string) => (id === "i1" ? { rating: "S" } : {}),
  } as unknown as InspectionContext;
}

describe("useInspectionNavigation — advanceToNextUnrated", () => {
  it("moves to the next unrated item while the editor is mounted", () => {
    const setActiveItemId = vi.fn();
    const { result } = renderHook(() => useInspectionNavigation(makeCtx(setActiveItemId)));
    result.current.advanceToNextUnrated();
    expect(setActiveItemId).toHaveBeenCalledWith("i2");
  });

  it("does nothing once the editor has unmounted, so a late auto-advance timer cannot touch a gone tree", () => {
    const setActiveItemId = vi.fn();
    const { result, unmount } = renderHook(() => useInspectionNavigation(makeCtx(setActiveItemId)));
    const advance = result.current.advanceToNextUnrated;
    unmount();
    advance();
    expect(setActiveItemId).not.toHaveBeenCalled();
  });
});
