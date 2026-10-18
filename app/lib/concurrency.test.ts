import { describe, expect, it, vi } from "vitest";
import { mapLimit, settled } from "./concurrency";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("mapLimit", () => {
  it("returns results in input order regardless of completion order", async () => {
    const out = await mapLimit([30, 5, 15, 1], 2, async (ms, i) => {
      await sleep(ms);
      return `${i}:${ms}`;
    });
    expect(out).toEqual(["0:30", "1:5", "2:15", "3:1"]);
  });

  it("never runs more than `limit` calls at once, and does use the whole limit", async () => {
    let active = 0;
    let peak = 0;
    await mapLimit(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await sleep(5);
      active -= 1;
    });
    expect(peak).toBe(4);
  });

  it("handles an empty list and a single item without starting extra workers", async () => {
    const fn = vi.fn(async (x: number) => x * 2);
    expect(await mapLimit([], 4, fn)).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
    expect(await mapLimit([21], 4, fn)).toEqual([42]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("rejects with the first failure and stops starting new items", async () => {
    const started: number[] = [];
    await expect(
      mapLimit([0, 1, 2, 3, 4, 5, 6, 7], 2, async (n) => {
        started.push(n);
        await sleep(2);
        if (n === 1) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
    await sleep(30);
    expect(started.length).toBeLessThan(8);
  });

  it("treats a non-positive limit as 1 rather than hanging", async () => {
    expect(await mapLimit([1, 2, 3], 0, async (n) => n + 1)).toEqual([2, 3, 4]);
  });

  it("turns a synchronous throw from the callback into a rejection", async () => {
    await expect(mapLimit([1], 2, (() => { throw new Error("sync"); }) as never)).rejects.toThrow("sync");
  });
});

describe("settled", () => {
  it("returns the value when the call succeeds in time", async () => {
    expect(await settled(async () => "ok", { fallback: "fb", label: "t" })).toBe("ok");
  });

  it("returns the fallback and reports the label when the call rejects", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await settled(async () => { throw new Error("nope"); }, { fallback: "fb", label: "tags" })).toBe("fb");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("tags");
    warn.mockRestore();
  });

  it("returns the fallback when the call throws synchronously (typed clients can)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fn = (() => { throw new TypeError("not callable"); }) as unknown as () => Promise<string>;
    expect(await settled(fn, { fallback: "fb", label: "sync" })).toBe("fb");
    warn.mockRestore();
  });

  it("returns the fallback when the call takes longer than the timeout", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t0 = performance.now();
    const out = await settled(() => sleep(200).then(() => "late"), { timeoutMs: 20, fallback: "fb", label: "slow" });
    expect(out).toBe("fb");
    expect(performance.now() - t0).toBeLessThan(150);
    warn.mockRestore();
  });

  it("does not cancel the underlying call when the timeout wins", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let finished = false;
    await settled(async () => { await sleep(40); finished = true; return 1; }, { timeoutMs: 5, fallback: 0, label: "x" });
    expect(finished).toBe(false);
    await sleep(80);
    expect(finished).toBe(true);
    warn.mockRestore();
  });

  it("a late rejection after the timeout is swallowed, not unhandled", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    await settled(async () => { await sleep(30); throw new Error("late"); }, { timeoutMs: 5, fallback: 0, label: "x" });
    await sleep(80);
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
