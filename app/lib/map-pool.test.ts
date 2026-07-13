import { describe, it, expect, vi } from "vitest";
import { mapPool } from "~/lib/map-pool";

/**
 * Bounded-concurrency promise pool used by the photo-upload BFF fan-out
 * (Phase 3 Task 15). Requirements under test:
 *  - results[i] corresponds to items[i] regardless of resolution order
 *  - at most `limit` workers run concurrently
 *  - a worker returning a failure result (not throwing) yields a mixed
 *    results array — the pool itself never rejects on a per-item failure
 */
describe("mapPool", () => {
  it("preserves input order even when later items resolve first", async () => {
    const items = ["a", "b", "c", "d"];
    // Deferred resolvers so we can control completion order explicitly —
    // item 'd' (index 3) resolves before item 'a' (index 0).
    const deferreds = items.map(() => {
      let resolve!: (v: string) => void;
      const promise = new Promise<string>((r) => {
        resolve = r;
      });
      return { promise, resolve };
    });

    const worker = vi.fn(
      (item: string, index: number) => deferreds[index].promise,
    );

    const resultPromise = mapPool(items, 2, worker);

    // Resolve out of order: d, b, a, c
    deferreds[3].resolve("D");
    deferreds[1].resolve("B");
    deferreds[0].resolve("A");
    deferreds[2].resolve("C");

    const results = await resultPromise;
    expect(results).toEqual(["A", "B", "C", "D"]);
  });

  it("never runs more than `limit` workers concurrently", async () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    let running = 0;
    let maxRunning = 0;

    const worker = async (item: number) => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      // Yield a couple of microtask turns so overlapping calls are observable.
      await Promise.resolve();
      await Promise.resolve();
      running -= 1;
      return item * 2;
    };

    const results = await mapPool(items, 3, worker);

    expect(maxRunning).toBeLessThanOrEqual(3);
    expect(results).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
  });

  it("supports partial success — a worker returning ok:false yields mixed results without rejecting the pool", async () => {
    const items = ["ok1", "bad", "ok2"];
    const worker = async (item: string) => {
      if (item === "bad") return { ok: false as const, error: "FAILED" };
      return { ok: true as const, value: item };
    };

    const results = await mapPool(items, 2, worker);

    expect(results).toEqual([
      { ok: true, value: "ok1" },
      { ok: false, error: "FAILED" },
      { ok: true, value: "ok2" },
    ]);
  });

  it("handles an empty items array", async () => {
    const worker = vi.fn(async (item: never) => item);
    const results = await mapPool([], 4, worker);
    expect(results).toEqual([]);
    expect(worker).not.toHaveBeenCalled();
  });

  it("handles limit larger than items.length", async () => {
    const items = [1, 2];
    const worker = async (item: number) => item + 100;
    const results = await mapPool(items, 10, worker);
    expect(results).toEqual([101, 102]);
  });
});
