// @vitest-environment happy-dom
/**
 * Deleting a video from the viewer: the entry leaves the results document only
 * once the server has freed the stored video. It used to drop the entry first and
 * send the delete without waiting, so a failed delete left the video in storage
 * with nothing in the report pointing at it, and nobody told.
 */
import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const toasts = vi.hoisted(() => [] as Array<{ message: string; variant?: string }>);
vi.mock("~/hooks/useToast", () => ({ pushToast: (t: { message: string; variant?: string }) => toasts.push(t) }));

import * as Y from "yjs";
import { seedResultsDoc, pushPendingPhoto, projectResults } from "../../server/lib/collab/results-doc";
import { usePhotoOps } from "~/hooks/usePhotoOps";

function makeCtx() {
  const setResults = vi.fn();
  const state = {
    inspection: { id: "insp1", coverPhotoId: null },
    sections: [], results: {}, currentSection: undefined,
    sectionIdForItem: (itemId: string) => (itemId === "i1" ? "s1" : null),
    setResults, setDirty: vi.fn(),
  };
  const findings = { getResult: () => ({ photos: [{ key: "v1" }] }) };
  const ctx = {
    state, findings, streamCustomerSubdomain: null, collabDoc: null, activeUnitId: null,
    setPhotoStudioUrl: vi.fn(), setPhotoStudioKey: vi.fn(), setPhotoStudioIndex: vi.fn(),
    setPhotoStudioTotal: vi.fn(), setPhotoStudioOpen: vi.fn(),
  };
  return { ctx: ctx as unknown as Parameters<typeof usePhotoOps>[0], setResults };
}
const VIDEO = { key: "v1", url: "", label: "Clip", itemId: "i1", photoIndex: 0, mediaType: "video", provider: "stream", streamUid: "uid-1" } as never;

let answer: () => Response | Promise<Response>;
let calls: Array<[string, string | undefined]>;
beforeEach(() => {
  toasts.length = 0; calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => { calls.push([url, init?.method]); return answer(); }));
});
afterEach(() => vi.unstubAllGlobals());

const run = async (setup = makeCtx()) => {
  const { result } = renderHook(() => usePhotoOps(setup.ctx));
  await act(async () => { result.current.onViewerAction("delete", VIDEO); await new Promise((r) => setTimeout(r, 30)); });
  return setup;
};

describe("usePhotoOps video delete", () => {
  it("removes the entry only after the server freed the video", async () => {
    answer = () => new Response("{}", { status: 200 });
    const { setResults } = await run();
    expect(calls).toEqual([["/api/inspections/insp1/media/video/uid-1", "DELETE"]]);
    await waitFor(() => expect(setResults).toHaveBeenCalled());
    expect(toasts).toEqual([]);
  });

  it("treats a video that is already gone (404) as deleted", async () => {
    answer = () => new Response("{}", { status: 404 });
    const { setResults } = await run();
    await waitFor(() => expect(setResults).toHaveBeenCalled());
    expect(toasts).toEqual([]);
  });

  it.each([
    ["the server answers an error", () => new Response("{}", { status: 500 })],
    ["the request cannot be made", () => { throw new TypeError("offline"); }],
  ] as Array<[string, () => Response]>)("keeps the entry and says so when %s", async (_n, a) => {
    answer = a;
    const { setResults } = await run();
    expect(setResults).not.toHaveBeenCalled();
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.variant).toBe("error");
    expect(toasts[0]!.message).toMatch(/could not be deleted/i);
  });

  it("removes the entry by its key, not by the position it had when the delete started", async () => {
    answer = () => new Response("{}", { status: 200 });
    const { ctx, setResults } = makeCtx();
    const { result } = renderHook(() => usePhotoOps(ctx));
    await act(async () => { result.current.onViewerAction("delete", VIDEO); await new Promise((r) => setTimeout(r, 30)); });
    // Between the click and the answer another photo was added above the video.
    const updater = setResults.mock.calls[0]![0] as (prev: Record<string, unknown>) => Record<string, { photos: Array<{ key: string }> }>;
    const out = updater({ i1: { photos: [{ key: "new-photo" }, { key: "v1" }] }, "_default:s1:i1": { photos: [{ key: "new-photo" }, { key: "v1" }] } });
    expect(Object.values(out).every((f) => f.photos.map((p) => p.key).join() === "new-photo")).toBe(true);
  });

  it("a second delete of the same video while the first is in flight sends nothing", async () => {
    let release: () => void = () => {};
    answer = () => new Promise<Response>((resolve) => { release = () => resolve(new Response("{}", { status: 200 })); });
    const { ctx, setResults } = makeCtx();
    const { result } = renderHook(() => usePhotoOps(ctx));
    await act(async () => { result.current.onViewerAction("delete", VIDEO); result.current.onViewerAction("delete", VIDEO); });
    expect(calls).toHaveLength(1);
    await act(async () => { release(); await new Promise((r) => setTimeout(r, 30)); });
    expect(setResults).toHaveBeenCalledTimes(1);
  });

  it("after a failed delete the same video can be deleted again", async () => {
    answer = () => new Response("{}", { status: 500 });
    const setup = makeCtx();
    const { result } = renderHook(() => usePhotoOps(setup.ctx));
    await act(async () => { result.current.onViewerAction("delete", VIDEO); await new Promise((r) => setTimeout(r, 30)); });
    answer = () => new Response("{}", { status: 200 });
    await act(async () => { result.current.onViewerAction("delete", VIDEO); await new Promise((r) => setTimeout(r, 30)); });
    expect(calls).toHaveLength(2);
    expect(setup.setResults).toHaveBeenCalledTimes(1);
  });

  it("a keyless video is freed on the server, then removed by what was freed, not by the position it had at click time", async () => {
    answer = () => new Response("{}", { status: 200 });
    const { ctx, setResults } = makeCtx();
    const { result } = renderHook(() => usePhotoOps(ctx));
    const keyless = { ...(VIDEO as object), key: "", photoIndex: 1 } as never;
    await act(async () => { result.current.onViewerAction("delete", keyless); await new Promise((r) => setTimeout(r, 30)); });
    expect(calls).toEqual([["/api/inspections/insp1/media/video/uid-1", "DELETE"]]);
    await waitFor(() => expect(setResults).toHaveBeenCalled());
    const updater = setResults.mock.calls[0]![0] as (prev: Record<string, unknown>) => Record<string, { photos: Array<{ key: string; streamUid?: string }> }>;
    // While the delete was in flight another entry was added above it and a second keyless video sits below.
    const out = updater({ i1: { photos: [{ key: "new" }, { key: "", streamUid: "other" }, { key: "", streamUid: "uid-1" }, { key: "p9" }] } });
    expect(out.i1!.photos.map((p) => p.key + "|" + (p.streamUid ?? ""))).toEqual(["new|", "|other", "p9|"]);
  });

  it("a keyless video leaves the shared document too, by its stream uid, so the other editors cannot bring it back", async () => {
    answer = () => new Response("{}", { status: 200 });
    const doc = new Y.Doc();
    seedResultsDoc(doc, [{ findingKey: "_default:s1:i1" }]);
    pushPendingPhoto(doc, "_default:s1:i1", { key: "", pendingId: "a", mediaType: "video", provider: "stream", streamUid: "uid-1" });
    pushPendingPhoto(doc, "_default:s1:i1", { key: "", pendingId: "b", mediaType: "video", provider: "stream", streamUid: "uid-2" });
    const setup = makeCtx();
    (setup.ctx as unknown as { collabDoc: Y.Doc }).collabDoc = doc;
    const { result } = renderHook(() => usePhotoOps(setup.ctx));
    const keyless = { ...(VIDEO as object), key: "", photoIndex: 0 } as never;
    await act(async () => { result.current.onViewerAction("delete", keyless); await new Promise((r) => setTimeout(r, 30)); });
    await waitFor(() => expect((projectResults(doc)["_default:s1:i1"].photos ?? []).map((p) => p.streamUid)).toEqual(["uid-2"]));
  });

  it("a keyless entry whose delete fails stays and says so", async () => {
    answer = () => new Response("{}", { status: 500 });
    const { ctx, setResults } = makeCtx();
    const { result } = renderHook(() => usePhotoOps(ctx));
    const keyless = { ...(VIDEO as object), key: "", photoIndex: 0 } as never;
    await act(async () => { result.current.onViewerAction("delete", keyless); await new Promise((r) => setTimeout(r, 30)); });
    expect(setResults).not.toHaveBeenCalled();
    expect(toasts).toHaveLength(1);
  });
});
