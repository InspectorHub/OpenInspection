// @vitest-environment happy-dom
/**
 * When the guarded submit refuses to send a chunk (a send already in the same
 * frame), the run must still end: the rows must not stay hidden with the bar
 * working forever, and a run whose earlier chunk skipped the list's reload must
 * still re-read the list once at the end.
 */
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const guard = vi.hoisted(() => ({
  fetcher: { state: "idle" as string, data: undefined as unknown },
  sends: [] as Array<Record<string, string>>,
  accept: [] as boolean[],
}));
vi.mock("~/hooks/useGuardedSubmit", () => ({
  useGuardedSubmit: () => ({
    fetcher: guard.fetcher,
    submit: (payload: Record<string, string>) => {
      guard.sends.push(payload);
      return guard.accept.shift() ?? true;
    },
  }),
}));
const revalidate = vi.hoisted(() => vi.fn());
vi.mock("react-router", async (orig) => ({ ...(await orig<typeof import("react-router")>()), useRevalidator: () => ({ revalidate, state: "idle" }) }));
vi.mock("~/lib/collab/offline-purge", () => ({ purgeInspectionOfflineData: vi.fn(async () => undefined) }));

import { useBatchDelete } from "~/hooks/useBatchDelete";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `r${i}`);

beforeEach(() => {
  guard.fetcher = { state: "idle", data: undefined };
  guard.sends = [];
  guard.accept = [];
  revalidate.mockClear();
});

describe("useBatchDelete when a send is refused", () => {
  it("ends the run at once when the first send is refused: nothing stays hidden, the ids are reported", () => {
    guard.accept = [false];
    const onSettled = vi.fn();
    const { result } = renderHook(() => useBatchDelete(new Set(ids(3)), onSettled));
    act(() => { result.current.deleteMany(["r0", "r1"]); });
    expect(result.current.busy).toBe(false);
    expect([...result.current.hiddenIds]).toEqual([]);
    expect(result.current.failures.map((f) => f.id)).toEqual(["r0", "r1"]);
    expect(onSettled).toHaveBeenCalledWith(new Set(["r0", "r1"]));
  });

  it("skips past refused chunks to the next one that can be sent", () => {
    guard.accept = [false, true];
    const { result } = renderHook(() => useBatchDelete(new Set(ids(12)), vi.fn()));
    act(() => { result.current.deleteMany(ids(12)); });
    expect(guard.sends).toHaveLength(2);
    expect(guard.sends[1]!.ids).toBe("r10,r11");
    expect(result.current.busy).toBe(true);
    expect(result.current.failures).toEqual([]);
  });

  it("re-reads the list once when the chunks after a skipped reload are all refused", () => {
    guard.accept = [true, false];
    const onSettled = vi.fn();
    const { result, rerender } = renderHook(() => useBatchDelete(new Set(ids(11)), onSettled));
    act(() => { result.current.deleteMany(ids(11)); });
    expect(guard.sends[0]!.more).toBe("1");
    // The first chunk was answered; the router skipped its reload because more was coming.
    guard.fetcher = { state: "idle", data: { ok: true, intent: "delete-many", deleted: ids(10), failed: [] } };
    act(() => { rerender(); });
    expect(result.current.busy).toBe(false);
    expect(result.current.failures.map((f) => f.id)).toEqual(["r10"]);
    expect(onSettled).toHaveBeenCalledWith(new Set(["r10"]));
    expect(revalidate).toHaveBeenCalledTimes(1);
  });

  it("does not add a second re-read when the last chunk was sent normally (its own answer reloads)", () => {
    guard.accept = [true, true];
    const { result, rerender } = renderHook(() => useBatchDelete(new Set(ids(11)), vi.fn()));
    act(() => { result.current.deleteMany(ids(11)); });
    guard.fetcher = { state: "idle", data: { ok: true, intent: "delete-many", deleted: ids(10), failed: [] } };
    act(() => { rerender(); });
    guard.fetcher = { state: "idle", data: { ok: true, intent: "delete-many", deleted: ["r10"], failed: [] } };
    act(() => { rerender(); });
    expect(result.current.busy).toBe(false);
    expect(revalidate).not.toHaveBeenCalled();
  });
});
