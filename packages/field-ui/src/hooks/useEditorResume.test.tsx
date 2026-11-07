// @vitest-environment happy-dom
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { placeToOpen, readLastPlace, useEditorResume } from "./useEditorResume";

afterEach(() => localStorage.clear());

const sections = [
  { id: "roof", items: [{ id: "r1" }, { id: "r2" }] },
  { id: "attic", items: [{ id: "a1" }] },
];

describe("placeToOpen", () => {
  it("opens on the saved place when it still exists", () => {
    expect(placeToOpen(sections, { sectionId: "attic", itemId: "a1" })).toEqual({ sectionId: "attic", itemId: "a1" });
  });
  it("falls back to the first item when the saved one is gone or nothing is saved", () => {
    expect(placeToOpen(sections, { sectionId: "attic", itemId: "gone" })).toEqual({ sectionId: "roof", itemId: "r1" });
    expect(placeToOpen(sections, null)).toEqual({ sectionId: "roof", itemId: "r1" });
  });
  it("skips sections with no items and returns null when there are none at all", () => {
    expect(placeToOpen([{ id: "x", items: [] }, { id: "y", items: [{ id: "y1" }] }], null)).toEqual({ sectionId: "y", itemId: "y1" });
    expect(placeToOpen([{ id: "x" }], null)).toBeNull();
  });
});

describe("useEditorResume", () => {
  it("opens the first item of an inspection that has never been opened", () => {
    const openPlace = vi.fn();
    renderHook(() => useEditorResume({ inspectionId: "i1", sections, activeItemId: null, activeSectionId: "roof", openPlace }));
    expect(openPlace).toHaveBeenCalledTimes(1);
    expect(openPlace).toHaveBeenCalledWith({ sectionId: "roof", itemId: "r1" });
  });

  it("remembers the item the person is on and opens it next time", () => {
    const openPlace = vi.fn();
    const first = renderHook((p: { item: string | null; section: string }) => useEditorResume({ inspectionId: "i1", sections, activeItemId: p.item, activeSectionId: p.section, openPlace }), {
      initialProps: { item: null as string | null, section: "roof" },
    });
    first.rerender({ item: "a1", section: "attic" });
    expect(readLastPlace("i1")).toEqual({ sectionId: "attic", itemId: "a1" });
    first.unmount();
    const again = vi.fn();
    renderHook(() => useEditorResume({ inspectionId: "i1", sections, activeItemId: null, activeSectionId: undefined, openPlace: again }));
    expect(again).toHaveBeenCalledWith({ sectionId: "attic", itemId: "a1" });
  });

  it("keeps each inspection's place apart", () => {
    localStorage.setItem("oi:editor:last-item:other", JSON.stringify({ sectionId: "attic", itemId: "a1" }));
    const openPlace = vi.fn();
    renderHook(() => useEditorResume({ inspectionId: "i1", sections, activeItemId: null, activeSectionId: undefined, openPlace }));
    expect(openPlace).toHaveBeenCalledWith({ sectionId: "roof", itemId: "r1" });
  });

  it("does not move a selection that already exists, and opens only once", () => {
    const openPlace = vi.fn();
    const view = renderHook(() => useEditorResume({ inspectionId: "i1", sections, activeItemId: "r2", activeSectionId: "roof", openPlace }));
    view.rerender();
    expect(openPlace).not.toHaveBeenCalled();
  });

  it("ignores a saved value that is not a place", () => {
    localStorage.setItem("oi:editor:last-item:i1", "{not json");
    expect(readLastPlace("i1")).toBeNull();
    localStorage.setItem("oi:editor:last-item:i1", JSON.stringify({ sectionId: 3 }));
    expect(readLastPlace("i1")).toBeNull();
  });
});
