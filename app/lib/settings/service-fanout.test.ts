import { describe, expect, it } from "vitest";
import { loadServiceFanout } from "./service-fanout.server";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A fake typed client that counts calls and the peak number in flight. */
function fakeApi(opts: { failInspectorsFor?: string; failPayFor?: string } = {}) {
  const stats = { inspectors: 0, payRules: 0, active: 0, peak: 0 };
  const track = async <T,>(fn: () => T): Promise<T> => {
    stats.active += 1;
    stats.peak = Math.max(stats.peak, stats.active);
    await sleep(5);
    stats.active -= 1;
    return fn();
  };
  const ok = (data: unknown) => ({ ok: true, json: async () => ({ data }) });
  const api = {
    services: {
      ":id": {
        inspectors: {
          $get: ({ param }: { param: { id: string } }) => {
            stats.inspectors += 1;
            if (param.id === opts.failInspectorsFor) throw new Error("sync failure");
            return track(() => ok({ userIds: [`u-${param.id}`] }));
          },
        },
        "pay-rules": {
          $get: ({ param }: { param: { id: string } }) => {
            stats.payRules += 1;
            if (param.id === opts.failPayFor) return Promise.resolve({ ok: false, json: async () => ({}) });
            return track(() => ok([{ id: `r-${param.id}` }]));
          },
        },
      },
    },
  };
  return { api: api as never, stats };
}

describe("loadServiceFanout", () => {
  it("makes no calls for no services", async () => {
    const { api, stats } = fakeApi();
    const out = await loadServiceFanout(api, []);
    expect(out).toEqual({ restrictionMap: {}, payRuleMap: {} });
    expect(stats.inspectors + stats.payRules).toBe(0);
  });

  it("makes exactly one call of each kind for one service", async () => {
    const { api, stats } = fakeApi();
    const out = await loadServiceFanout(api, ["a"]);
    expect(stats.inspectors).toBe(1);
    expect(stats.payRules).toBe(1);
    expect(out.restrictionMap).toEqual({ a: ["u-a"] });
    expect(out.payRuleMap).toEqual({ a: [{ id: "r-a" }] });
  });

  it("with many services: the calls are linear, concurrency is bounded, and both fan-outs overlap", async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `s${i}`);
    const { api, stats } = fakeApi();
    const t0 = performance.now();
    const out = await loadServiceFanout(api, ids);
    const elapsed = performance.now() - t0;
    expect(stats.inspectors).toBe(25);
    expect(stats.payRules).toBe(25);
    // Two fan-outs of 4 each run together: never more than 8 in flight, and
    // more than 4 (they overlap rather than run one after the other).
    expect(stats.peak).toBeLessThanOrEqual(8);
    expect(stats.peak).toBeGreaterThan(4);
    // 50 calls of 5 ms through 8 lanes is ~35 ms; one lane after another would be 250.
    expect(elapsed).toBeLessThan(150);
    expect(Object.keys(out.restrictionMap)).toHaveLength(25);
    expect(Object.keys(out.payRuleMap)).toHaveLength(25);
  });

  it("a failing read degrades that service only (empty list), whether it throws or answers non-ok", async () => {
    const { api } = fakeApi({ failInspectorsFor: "b", failPayFor: "c" });
    const out = await loadServiceFanout(api, ["a", "b", "c"]);
    expect(out.restrictionMap).toEqual({ a: ["u-a"], b: [], c: ["u-c"] });
    expect(out.payRuleMap.a).toEqual([{ id: "r-a" }]);
    expect(out.payRuleMap.c).toEqual([]);
  });
});
