// @vitest-environment happy-dom
/**
 * Speed mode's rating and Undo, apart from any layout: the queue, the last item staying up as "all rated" so it can
 * be undone, the write going to the unit the rating was made in, and a cleared '' meaning null.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useRef, useState } from "react";
import * as Y from "yjs";
import { readResultMap } from "../collab/results-binding";
import { useSpeedRating, type SpeedStateSlice } from "./useSpeedRating";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const ITEMS = [
  { id: "i1", label: "One", sectionName: "S", sectionIdx: 0, itemIdx: 0, rating: null },
  { id: "i2", label: "Two", sectionName: "S", sectionIdx: 0, itemIdx: 1, rating: null },
];
const LEVELS = [{ id: "ok", label: "OK" }, { id: "def", label: "Def" }];

function setup(opts: { activeUnitId?: string | null } = {}) {
  const doc = new Y.Doc();
  const writes: unknown[][] = [];
  const hook = renderHook(
    ({ activeUnitId }: { activeUnitId: string | null }) => {
      const [speedMode, setSpeedMode] = useState(true);
      const [speedQueue, setSpeedQueue] = useState([0, 1]);
      const [speedCurrent, setSpeedCurrent] = useState(0);
      const speedItemsRef = useRef(ITEMS);
      const state: SpeedStateSlice = {
        speedMode, speedQueue, speedCurrent, speedItemsRef, ratingLevels: LEVELS,
        setSpeedMode, setSpeedQueue, setSpeedCurrent,
        sectionIdForItem: () => "s1",
        setDirty: () => {},
      };
      const commitRating = (sid: string, id: string, r: string | null) => { writes.push([sid, id, r]); };
      return { state, api: useSpeedRating({ state, commitRating, doc, activeUnitId }) };
    },
    { initialProps: { activeUnitId: opts.activeUnitId ?? null } },
  );
  return { hook, doc, writes };
}

describe("useSpeedRating", () => {
  it("rating the last item keeps the overlay as 'all rated' for the toast, then leaves it", () => {
    const { hook } = setup();
    act(() => hook.result.current.api.speedRate(0));
    act(() => hook.result.current.api.speedRate(0));
    expect(hook.result.current.state.speedQueue).toEqual([]);
    expect(hook.result.current.state.speedMode).toBe(true);
    expect(hook.result.current.api.finishedItem?.id).toBe("i2");
    // Still up while the 3 s toast could still be showing ...
    act(() => { vi.advanceTimersByTime(3000); });
    expect(hook.result.current.state.speedMode).toBe(true);
    // ... and gone shortly after it.
    act(() => { vi.advanceTimersByTime(600); });
    expect(hook.result.current.state.speedMode).toBe(false);
  });

  it("undoing the last item puts it back in the queue, shows it again, and cancels the exit", () => {
    const { hook, writes } = setup();
    act(() => hook.result.current.api.speedRate(0));
    act(() => hook.result.current.api.speedRate(1));
    act(() => hook.result.current.api.undoSpeedRating("i2", null));
    expect(writes.at(-1)).toEqual(["s1", "i2", null]);
    expect(hook.result.current.state.speedQueue).toEqual([1]);
    expect(hook.result.current.api.finishedItem).toBeNull();
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(hook.result.current.state.speedMode).toBe(true);
  });

  it("an empty string as the previous value is written back as null", () => {
    const { hook, writes } = setup();
    act(() => hook.result.current.api.speedRate(0));
    act(() => hook.result.current.api.undoSpeedRating("i1", ""));
    expect(writes.at(-1)).toEqual(["s1", "i1", null]);
  });

  it("an Undo after the unit changed writes to the unit the rating was made in", () => {
    const { hook, doc, writes } = setup({ activeUnitId: "u1" });
    act(() => hook.result.current.api.speedRate(1));
    hook.rerender({ activeUnitId: null });
    act(() => hook.result.current.api.undoSpeedRating("i1", "ok"));
    // The write did not go through the current (common) scope's commit; it went to u1's finding in the document.
    expect(writes.filter((w) => w[2] === "ok")).toHaveLength(0);
    expect(readResultMap(doc)["u1:s1:i1"]?.rating).toBe("ok");
    expect(readResultMap(doc)["_default:s1:i1"]).toBeUndefined();
  });
});
