import { describe, expect, it } from "vitest";
import { reorderCredentials } from "./credential-reorder.server";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fakeApi(behaviour: (id: string) => "ok" | "notok" | "throw") {
  const sent: Array<{ id: string; sortOrder: number }> = [];
  const api = {
    credentials: {
      ":id": {
        $patch: async ({ param, json }: { param: { id: string }; json: { sortOrder: number } }) => {
          sent.push({ id: param.id, sortOrder: json.sortOrder });
          await sleep(2);
          const b = behaviour(param.id);
          if (b === "throw") throw new Error("boom");
          return { ok: b === "ok" };
        },
      },
    },
  };
  return { api: api as never, sent };
}

describe("reorderCredentials", () => {
  it("sends every id its own sortOrder and reports success", async () => {
    const ids = Array.from({ length: 9 }, (_, i) => `c${i}`);
    const { api, sent } = fakeApi(() => "ok");
    expect(await reorderCredentials(api, ids)).toEqual({ failed: null });
    expect(sent.map((s) => s.sortOrder).sort((a, b) => a - b)).toEqual(ids.map((_, i) => i));
    expect(sent.find((s) => s.id === "c5")?.sortOrder).toBe(5);
  });

  it("still attempts every item when one request throws, and reports the failure", async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `c${i}`);
    const { api, sent } = fakeApi((id) => (id === "c1" ? "throw" : "ok"));
    const out = await reorderCredentials(api, ids);
    expect(sent).toHaveLength(10);
    expect(out.failed).toBe("threw");
  });

  it("returns the first non-ok response so its message can be shown, after attempting all", async () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    const { api, sent } = fakeApi((id) => (id === "b" ? "notok" : "ok"));
    const out = await reorderCredentials(api, ids);
    expect(sent).toHaveLength(6);
    expect(out.failed).toMatchObject({ ok: false });
  });

  it("does nothing for an empty list", async () => {
    const { api, sent } = fakeApi(() => "ok");
    expect(await reorderCredentials(api, [])).toEqual({ failed: null });
    expect(sent).toHaveLength(0);
  });
});
