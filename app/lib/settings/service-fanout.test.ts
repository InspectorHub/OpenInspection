import { describe, expect, it } from "vitest";
import { loadServiceFanout } from "./service-fanout.server";

/** A fake typed client for the two bulk reads; it records every call. */
function fakeApi(opts: { failInspectors?: boolean; failPay?: "nonok" | "throw" } = {}) {
  const calls = { inspectors: [] as string[][], payRules: [] as string[][] };
  const idsOf = (query: { ids: string }) => query.ids.split(",").filter(Boolean);
  const api = {
    services: {
      "inspectors-by-service": {
        $get: async ({ query }: { query: { ids: string } }) => {
          const ids = idsOf(query);
          calls.inspectors.push(ids);
          if (opts.failInspectors) return { ok: false, json: async () => ({}) };
          return { ok: true, json: async () => ({ data: Object.fromEntries(ids.map((id) => [id, [`u-${id}`]])) }) };
        },
      },
      "pay-rules-by-service": {
        $get: async ({ query }: { query: { ids: string } }) => {
          const ids = idsOf(query);
          calls.payRules.push(ids);
          if (opts.failPay === "throw") throw new Error("sync failure");
          if (opts.failPay === "nonok") return { ok: false, json: async () => ({}) };
          return { ok: true, json: async () => ({ data: Object.fromEntries(ids.map((id) => [id, [{ id: `r-${id}` }]])) }) };
        },
      },
    },
  };
  return { api: api as never, calls };
}

describe("loadServiceFanout", () => {
  it("makes no calls for no services", async () => {
    const { api, calls } = fakeApi();
    expect(await loadServiceFanout(api, [])).toEqual({ restrictionMap: {}, payRuleMap: {} });
    expect(calls.inspectors.length + calls.payRules.length).toBe(0);
  });

  it("makes one call of each kind for one service", async () => {
    const { api, calls } = fakeApi();
    const out = await loadServiceFanout(api, ["a"]);
    expect(calls.inspectors).toEqual([["a"]]);
    expect(calls.payRules).toEqual([["a"]]);
    expect(out.restrictionMap).toEqual({ a: ["u-a"] });
    expect(out.payRuleMap).toEqual({ a: [{ id: "r-a" }] });
  });

  it("makes the same two calls for many services: the count does not grow with S", async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `s${i}`);
    const { api, calls } = fakeApi();
    const out = await loadServiceFanout(api, ids);
    expect(calls.inspectors).toHaveLength(1);
    expect(calls.payRules).toHaveLength(1);
    expect(Object.keys(out.restrictionMap)).toHaveLength(25);
    expect(Object.keys(out.payRuleMap)).toHaveLength(25);
  });

  it("splits only past the per-request id limit (100), one call per chunk", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `s${i}`);
    const { api, calls } = fakeApi();
    const out = await loadServiceFanout(api, ids);
    expect(calls.inspectors.map((c) => c.length)).toEqual([100, 100, 50]);
    expect(calls.payRules.map((c) => c.length)).toEqual([100, 100, 50]);
    expect(Object.keys(out.restrictionMap)).toHaveLength(250);
  });

  it("a failed read degrades that map to empty lists for every service, without failing the other", async () => {
    const { api } = fakeApi({ failInspectors: true, failPay: "throw" });
    const out = await loadServiceFanout(api, ["a", "b"]);
    expect(out.restrictionMap).toEqual({ a: [], b: [] });
    expect(out.payRuleMap).toEqual({ a: [], b: [] });
    const half = await loadServiceFanout(fakeApi({ failPay: "nonok" }).api, ["a"]);
    expect(half.restrictionMap).toEqual({ a: ["u-a"] });
    expect(half.payRuleMap).toEqual({ a: [] });
  });

  it("fills a service the answer omits with an empty list, so the page never sees undefined", async () => {
    const api = {
      services: {
        "inspectors-by-service": { $get: async () => ({ ok: true, json: async () => ({ data: {} }) }) },
        "pay-rules-by-service": { $get: async () => ({ ok: true, json: async () => ({ data: {} }) }) },
      },
    } as never;
    const out = await loadServiceFanout(api, ["gone"]);
    expect(out).toEqual({ restrictionMap: { gone: [] }, payRuleMap: { gone: [] } });
  });
});
