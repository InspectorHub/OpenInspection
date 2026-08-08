// @vitest-environment happy-dom
/**
 * The Repair Request Builder's persistence queue — specifically, the one branch
 * that used to throw away the client's edits.
 *
 * Ticking a defect enqueues an `add-item`; choosing an action or typing a note
 * immediately afterwards enqueues an `update-item` keyed by `findingKey`, whose
 * server item id does not exist yet. That branch dropped the op, justified by a
 * DIFFERENT case (added and removed before the add resolved) — so the ordinary
 * path lost the choice with the row still showing it, no error, and the column
 * left NULL.
 *
 * ⚠️ It is a real-world race, not a theoretical one: `drainQueue` guards on a
 * `mutationFetcher.state` value CAPTURED at render, while a click handler can
 * hold a closure from before the add was submitted. That is why these cases
 * drive the hook through a FAKE fetcher whose state they control, rather than
 * hoping a real one lands in the window.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

/** The single fake fetcher pair the hook sees, with state under test control. */
const fetchers: { state: string; data: unknown; submit: ReturnType<typeof vi.fn> }[] = [];

vi.mock("react-router", () => ({
  useFetcher: () => {
    // ⚠️ Two calls per render, in DECLARATION order: [0] = createFetcher,
    // [1] = mutationFetcher. Getting this backwards made the "drops a ghost
    // update" case below pass while asserting against the wrong fetcher — it
    // expects zero submissions, which an unused fetcher satisfies for free.
    // Created once and reused so `state` mutations survive re-renders.
    const idx = callIndex++;
    fetchers[idx] ??= { state: "idle", data: undefined, submit: vi.fn() };
    return fetchers[idx];
  },
}));

let callIndex = 0;

async function load() {
  return (await import("./useRepairOpQueue")).useRepairOpQueue;
}

function op(intent: string, findingKey: string) {
  const fd = new FormData();
  fd.append("_intent", intent);
  if (intent === "add-item") fd.append("findingKey", findingKey);
  else fd.append("_findingKey", findingKey);
  return fd;
}

/** The op bodies actually submitted, in order, as plain intents+keys. */
function submitted(f: { submit: ReturnType<typeof vi.fn> }) {
  return f.submit.mock.calls.map(([fd]: [FormData]) => ({
    intent: fd.get("_intent"),
    key: fd.get("findingKey") ?? fd.get("_findingKey"),
    itemId: fd.get("itemId"),
  }));
}

describe("useRepairOpQueue — an update enqueued while its add is in flight", () => {
  beforeEach(() => {
    fetchers.length = 0;
    callIndex = 0;
  });

  it("does not discard the update, and sends it once the add resolves", async () => {
    const useRepairOpQueue = await load();
    const { result, rerender } = renderHook(() => {
      callIndex = 0;
      return useRepairOpQueue({
        initialRrId: "rr-1",
        initialItemIds: {},
        token: "t",
        actionPath: "/a",
      });
    });
    const mutation = fetchers[1];

    // Tick the defect. The add submits immediately.
    act(() => result.current.enqueueOp(op("add-item", "k1")));
    expect(submitted(mutation!)).toEqual([
      { intent: "add-item", key: "k1", itemId: null },
    ]);

    // Choose an action before the add has settled. The hook's own idle guard is
    // stale here — the point of the bug — so the op reaches the id lookup.
    act(() => result.current.enqueueOp(op("update-item", "k1")));
    expect(submitted(mutation!)).toHaveLength(1); // still just the add

    // The add settles and reports the server id.
    act(() => {
      mutation!.state = "idle";
      mutation!.data = { ok: true, data: { id: "item-9", findingKey: "k1" } };
      rerender();
    });

    const calls = submitted(mutation!);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual({ intent: "update-item", key: "k1", itemId: "item-9" });
  });

  it("still drops an update for an item that will never exist", async () => {
    // The case the old comment described, and the bound on the new deferral: no
    // add in flight and none queued means nothing will ever resolve this id, so
    // requeueing would spin forever.
    const useRepairOpQueue = await load();
    const { result } = renderHook(() => {
      callIndex = 0;
      return useRepairOpQueue({
        initialRrId: "rr-1",
        initialItemIds: {},
        token: "t",
        actionPath: "/a",
      });
    });
    const mutation = fetchers[1];

    act(() => result.current.enqueueOp(op("update-item", "ghost")));
    expect(submitted(mutation!)).toHaveLength(0);
  });

  it("keeps an already-known item id working", async () => {
    // The control. Without it, both cases above are satisfied by a queue that
    // never submits anything at all.
    const useRepairOpQueue = await load();
    const { result } = renderHook(() => {
      callIndex = 0;
      return useRepairOpQueue({
        initialRrId: "rr-1",
        initialItemIds: { known: "item-1" },
        token: "t",
        actionPath: "/a",
      });
    });
    const mutation = fetchers[1];

    act(() => result.current.enqueueOp(op("update-item", "known")));
    expect(submitted(mutation!)).toEqual([
      { intent: "update-item", key: "known", itemId: "item-1" },
    ]);
  });
});
