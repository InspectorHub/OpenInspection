// @vitest-environment happy-dom
/**
 * Reordering an item's media when some entries have no file key: clips (empty `key`, identified by media id or stream uid) and
 * pending photos (identified by pending id). The optimistic list must keep every entry, in the order asked for.
 */
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { FieldDataSourceProvider } from "../context";
import { createEmptyEditorData, createFakeDataSource } from "../testing/fake-data-source";
import { usePhotoOps } from "./usePhotoOps";

const ds = createFakeDataSource({ data: createEmptyEditorData() });
const wrapper = ({ children }: { children: ReactNode }) => createElement(FieldDataSourceProvider, { dataSource: ds }, children);

function setup() {
  const setResults = vi.fn();
  const ctx = {
    state: {
      inspection: { id: "insp1", coverPhotoId: null }, sections: [], results: {}, currentSection: undefined,
      sectionIdForItem: () => "s1", setResults, setDirty: vi.fn(),
    },
    findings: { getResult: () => ({}) }, streamCustomerSubdomain: null, collabDoc: null, activeUnitId: null,
    setPhotoStudioUrl: vi.fn(), setPhotoStudioKey: vi.fn(), setPhotoStudioIndex: vi.fn(), setPhotoStudioTotal: vi.fn(), setPhotoStudioOpen: vi.fn(),
  } as unknown as Parameters<typeof usePhotoOps>[0];
  const { result } = renderHook(() => usePhotoOps(ctx), { wrapper });
  const apply = (photos: unknown[]) => {
    const updater = setResults.mock.calls.at(-1)![0] as (p: Record<string, unknown>) => Record<string, { photos: Array<Record<string, unknown>> }>;
    return updater({ "_default:s1:i1": { photos } })["_default:s1:i1"]!.photos;
  };
  return { result, apply };
}
const r2 = (mediaId: string) => ({ key: "", mediaType: "video", provider: "r2", mediaId });

describe("onReorderPhotos with keyless entries", () => {
  it("keeps both clips and the photo, in the requested order", () => {
    const { result, apply } = setup();
    act(() => result.current.onReorderPhotos("i1", ["m:b", "a.jpg", "m:a"]));
    const out = apply([r2("a"), { key: "a.jpg" }, r2("b")]);
    expect(out.map((p) => p.mediaId ?? p.key)).toEqual(["b", "a.jpg", "a"]);
  });

  it("keeps a pending photo and a clip", () => {
    const { result, apply } = setup();
    act(() => result.current.onReorderPhotos("i1", ["m:a", "p:pend1"]));
    const out = apply([{ key: "", pendingId: "pend1", pendingUpload: true }, r2("a")]);
    expect(out.map((p) => p.mediaId ?? p.pendingId)).toEqual(["a", "pend1"]);
  });

  it("a legacy Stream clip is addressed by its stream uid", () => {
    const { result, apply } = setup();
    act(() => result.current.onReorderPhotos("i1", ["s:u2", "s:u1"]));
    const out = apply([{ key: "", mediaType: "video", streamUid: "u1" }, { key: "", mediaType: "video", streamUid: "u2" }]);
    expect(out.map((p) => p.streamUid)).toEqual(["u2", "u1"]);
  });
});

describe("onReorderPhotos refuses when an entry has no name", () => {
  it("leaves the list exactly as it was", () => {
    const { result, apply } = setup();
    act(() => result.current.onReorderPhotos("i1", ["b.jpg", "a.jpg"]));
    const list = [{ key: "a.jpg" }, { key: "b.jpg" }, { key: "", caption: "nameless" }];
    expect(apply(list)).toEqual(list);
  });
});
