import { describe, it, expect } from "vitest";
import { loadVisits } from "./inspection-visits";

const ok = (data: unknown) => Promise.resolve({ ok: true, json: async () => ({ data }) });

function fakeApi(opts: { visits?: () => Promise<unknown>; types?: () => Promise<unknown> } = {}) {
  const started: string[] = [];
  const api = {
    events: {
      inspections: { ":inspectionId": { events: { $get: () => { started.push("visits"); return (opts.visits ?? (() => ok([{ id: "v1" }])))(); } } } },
      "event-types": { $get: () => { started.push("types"); return (opts.types ?? (() => ok([{ id: "t1", slug: "radon" }])))(); } },
    },
  };
  return { api: api as never, started };
}

describe("loadVisits", () => {
  it("requests the visits and the visit types in the same tick, not one after the other", async () => {
    const { api, started } = fakeApi({ visits: () => new Promise(() => {}) });
    void loadVisits(api, "i1", new Set(), []);
    // No awaiting: a serial implementation has not reached the second read yet.
    expect(started).toEqual(["visits", "types"]);
  });

  it("returns both lists and the suggestions drawn from them", async () => {
    const { api } = fakeApi();
    const out = await loadVisits(api, "i1", new Set(["s1"]), [{ id: "s1", name: "Radon", price: 1, defaultEventTypeSlugs: ["radon"] } as never]);
    expect(out.visits).toEqual([{ id: "v1" }]);
    expect(out.visitTypes).toEqual([{ id: "t1", slug: "radon" }]);
    expect(out.suggestedTypeIds).toEqual(["t1"]);
  });

  it("a failing read degrades only its own list (rejected, non-ok, or thrown synchronously is not required)", async () => {
    const { api } = fakeApi({ visits: () => Promise.reject(new Error("x")), types: () => Promise.resolve({ ok: false, json: async () => ({}) }) });
    expect(await loadVisits(api, "i1", new Set(), [])).toEqual({ visits: [], visitTypes: [], suggestedTypeIds: [] });
    const half = fakeApi({ visits: () => Promise.reject(new Error("x")) });
    const out = await loadVisits(half.api, "i1", new Set(), []);
    expect(out.visits).toEqual([]);
    expect(out.visitTypes).toHaveLength(1);
  });

  it("a missing endpoint on the client degrades to empty lists", async () => {
    expect(await loadVisits({} as never, "i1", new Set(), [])).toEqual({ visits: [], visitTypes: [], suggestedTypeIds: [] });
  });
});
