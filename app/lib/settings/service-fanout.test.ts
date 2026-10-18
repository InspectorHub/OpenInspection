import { describe, expect, it } from "vitest";
import { loadServiceFanout } from "./service-fanout.server";

/** A fake typed client for the two bulk reads; it records every call. */
function fakeApi(opts: { failInspectors?: boolean; failPay?: "nonok" | "throw"; failPerService?: boolean } = {}) {
  const calls = { inspectors: [] as string[][], payRules: [] as string[][], singleInspectors: [] as string[], singlePay: [] as string[] };
  const idsOf = (query: { ids: string }) => query.ids.split(",").filter(Boolean);
  const api = {
    services: {
      ":id": {
        inspectors: {
          $get: async ({ param }: { param: { id: string } }) => {
            calls.singleInspectors.push(param.id);
            if (opts.failPerService) return { ok: false, json: async () => ({}) };
            return { ok: true, json: async () => ({ data: { userIds: [`one-${param.id}`] } }) };
          },
        },
        "pay-rules": {
          $get: async ({ param }: { param: { id: string } }) => {
            calls.singlePay.push(param.id);
            if (opts.failPerService) return { ok: false, json: async () => ({}) };
            return { ok: true, json: async () => ({ data: [{ id: `one-r-${param.id}` }] }) };
          },
        },
      },
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

  it("splits only past the per-request id limit (90), one call per chunk", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `s${i}`);
    const { api, calls } = fakeApi();
    const out = await loadServiceFanout(api, ids);
    expect(calls.inspectors.map((c) => c.length)).toEqual([90, 90, 70]);
    expect(calls.payRules.map((c) => c.length)).toEqual([90, 90, 70]);
    expect(Object.keys(out.restrictionMap)).toHaveLength(250);
  });

  it("a failed bulk read falls back to the per-service reads for those services, so a failure never shows as an empty state", async () => {
    const { api, calls } = fakeApi({ failInspectors: true, failPay: "nonok" });
    const out = await loadServiceFanout(api, ["a", "b"]);
    expect(calls.singleInspectors.sort()).toEqual(["a", "b"]);
    expect(calls.singlePay.sort()).toEqual(["a", "b"]);
    expect(out.restrictionMap).toEqual({ a: ["one-a"], b: ["one-b"] });
    expect(out.payRuleMap).toEqual({ a: [{ id: "one-r-a" }], b: [{ id: "one-r-b" }] });
  });

  it("a bulk read that throws also falls back; the other bulk read is not repeated", async () => {
    const { api, calls } = fakeApi({ failPay: "throw" });
    const out = await loadServiceFanout(api, ["a"]);
    expect(calls.singlePay).toEqual(["a"]);
    expect(calls.singleInspectors).toEqual([]);
    expect(out.restrictionMap).toEqual({ a: ["u-a"] });
    expect(out.payRuleMap).toEqual({ a: [{ id: "one-r-a" }] });
  });

  it("only the failed chunk falls back", async () => {
    const ids = Array.from({ length: 100 }, (_, i) => `s${i}`);
    let n = 0;
    const base = fakeApi();
    const api = {
      services: {
        ...(base.api as { services: Record<string, unknown> }).services,
        "inspectors-by-service": {
          $get: async ({ query }: { query: { ids: string } }) => {
            n += 1;
            if (query.ids.startsWith("s90,")) return { ok: false, json: async () => ({}) };
            return { ok: true, json: async () => ({ data: Object.fromEntries(query.ids.split(",").map((id) => [id, ["bulk"]])) }) };
          },
        },
      },
    } as never;
    const out = await loadServiceFanout(api, ids);
    expect(n).toBe(2);
    expect(base.calls.singleInspectors).toHaveLength(10);
    expect(out.restrictionMap.s0).toEqual(["bulk"]);
    expect(out.restrictionMap.s95).toEqual(["one-s95"]);
  });

  it("when the per-service fallback fails as well, the old behaviour stands: empty lists", async () => {
    const { api } = fakeApi({ failInspectors: true, failPay: "nonok", failPerService: true });
    const out = await loadServiceFanout(api, ["a", "b"]);
    expect(out.restrictionMap).toEqual({ a: [], b: [] });
    expect(out.payRuleMap).toEqual({ a: [], b: [] });
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
