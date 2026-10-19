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
});
