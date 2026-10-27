// @vitest-environment happy-dom
/** The list's Delete tells the service worker about exactly the inspections the server confirmed deleted, once the run ends. */
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const guard = vi.hoisted(() => ({ fetcher: { state: "idle" as string, data: undefined as unknown } }));
vi.mock("~/hooks/useGuardedSubmit", () => ({ useGuardedSubmit: () => ({ fetcher: guard.fetcher, submit: () => true }) }));
vi.mock("react-router", async (orig) => ({ ...(await orig<typeof import("react-router")>()), useRevalidator: () => ({ revalidate: vi.fn(), state: "idle" }) }));
vi.mock("@core/field-ui/collab/offline-purge", () => ({ purgeInspectionOfflineData: vi.fn(async () => undefined) }));
const forget = vi.hoisted(() => vi.fn());
vi.mock("~/lib/forget-inspection", () => ({ forgetInspectionInServiceWorker: forget }));

import { useBatchDelete } from "~/hooks/useBatchDelete";

beforeEach(() => {
  guard.fetcher = { state: "idle", data: undefined };
  forget.mockClear();
});

describe("useBatchDelete and the service worker", () => {
  it("forgets the ids the server deleted, and not the ones it refused", () => {
    const { result, rerender } = renderHook(() => useBatchDelete(new Set(["a", "b", "c"]), vi.fn()));
    act(() => { result.current.deleteMany(["a", "b", "c"]); });
    guard.fetcher = { state: "idle", data: { intent: "delete-many", deleted: ["a", "c"], failed: [{ id: "b", error: "no" }] } };
    act(() => { rerender(); });
    expect(forget.mock.calls.map((c) => c[0]).sort()).toEqual(["a", "c"]);
  });

  it("CONTROL - a run that deleted nothing tells the worker nothing", () => {
    const { result, rerender } = renderHook(() => useBatchDelete(new Set(["a"]), vi.fn()));
    act(() => { result.current.deleteMany(["a"]); });
    guard.fetcher = { state: "idle", data: { intent: "delete-many", deleted: [], failed: [{ id: "a", error: "no" }] } };
    act(() => { rerender(); });
    expect(forget).not.toHaveBeenCalled();
  });
});
