// @vitest-environment happy-dom
/** Bulk detach and bulk move act on photos only: a clip index in the selection is ignored, not removed from the list while the document keeps it. */
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { FieldDataSourceProvider } from "../context";
import { createEmptyEditorData, createFakeDataSource } from "../testing/fake-data-source";
import { usePhotoOps } from "./usePhotoOps";

const ds = createFakeDataSource({ data: createEmptyEditorData() });
const wrapper = ({ children }: { children: ReactNode }) => createElement(FieldDataSourceProvider, { dataSource: ds }, children);
const PHOTOS = [{ key: "a.jpg" }, { key: "", mediaType: "video", provider: "r2", mediaId: "m1" }, { key: "b.jpg" }];

function setup() {
  const setResults = vi.fn();
  const ctx = {
    state: {
      inspection: { id: "insp1", coverPhotoId: null }, sections: [], results: {}, currentSection: undefined,
      sectionIdForItem: () => "s1", setResults, setDirty: vi.fn(),
    },
    findings: { getResult: () => ({ photos: PHOTOS }) }, streamCustomerSubdomain: null, collabDoc: null, activeUnitId: null,
    setPhotoStudioUrl: vi.fn(), setPhotoStudioKey: vi.fn(), setPhotoStudioIndex: vi.fn(), setPhotoStudioTotal: vi.fn(), setPhotoStudioOpen: vi.fn(),
  } as unknown as Parameters<typeof usePhotoOps>[0];
  const { result } = renderHook(() => usePhotoOps(ctx), { wrapper });
  const remaining = () => {
    const updater = setResults.mock.calls.at(-1)![0] as (p: Record<string, unknown>) => Record<string, { photos: Array<Record<string, unknown>> }>;
    return updater({ "_default:s1:i1": { photos: PHOTOS } })["_default:s1:i1"]!.photos.map((p) => p.mediaId ?? p.key);
  };
  return { result, remaining };
}

describe("bulk photo actions skip clips", () => {
  it("detach: a selected clip stays, the selected photos go", () => {
    const { result, remaining } = setup();
    act(() => result.current.onBulkDetachPhotos("i1", [2, 1, 0]));
    expect(remaining()).toEqual(["m1"]);
  });

  it("move: a selected clip stays on the source item", () => {
    const { result, remaining } = setup();
    act(() => result.current.onBulkMovePhotos("i1", [2, 1], { itemId: "i2", sectionId: "s1" }));
    expect(remaining()).toEqual(["a.jpg", "m1"]);
  });

  it("control: with only photos selected they all go", () => {
    const { result, remaining } = setup();
    act(() => result.current.onBulkDetachPhotos("i1", [2, 0]));
    expect(remaining()).toEqual(["m1"]);
  });
});
