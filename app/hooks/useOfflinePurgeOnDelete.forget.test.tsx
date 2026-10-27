// @vitest-environment happy-dom
/** The inspection page's Delete tells the service worker once the server has said it deleted: never before, never on a refusal. */
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@core/field-ui/collab/offline-purge", () => ({ purgeInspectionOfflineData: vi.fn(async () => undefined) }));
const forget = vi.hoisted(() => vi.fn());
vi.mock("~/lib/forget-inspection", () => ({ forgetInspectionInServiceWorker: forget }));

import { useOfflinePurgeOnDelete, type DeleteFetcherLike } from "~/hooks/useOfflinePurgeOnDelete";

beforeEach(() => forget.mockClear());

describe("useOfflinePurgeOnDelete and the service worker", () => {
  it("forgets the queued id after an ok delete answer, and not while it is in flight", () => {
    let fetcher: DeleteFetcherLike = { state: "submitting" };
    const { result, rerender } = renderHook(() => useOfflinePurgeOnDelete(fetcher));
    act(() => result.current(["i1"]));
    expect(forget).not.toHaveBeenCalled();
    fetcher = { state: "idle", data: { intent: "delete", ok: true } };
    act(() => rerender());
    expect(forget).toHaveBeenCalledExactlyOnceWith("i1");
  });

  it("CONTROL - a refused delete forgets nothing", () => {
    let fetcher: DeleteFetcherLike = { state: "submitting" };
    const { result, rerender } = renderHook(() => useOfflinePurgeOnDelete(fetcher));
    act(() => result.current(["i1"]));
    fetcher = { state: "idle", data: { intent: "delete", ok: false } };
    act(() => rerender());
    expect(forget).not.toHaveBeenCalled();
  });
});
