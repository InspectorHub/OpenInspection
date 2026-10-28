/**
 * The relay for the editor's item tags. The ids arrive from the query string and the form body, and the typed client
 * writes a path parameter into the URL exactly as given, so what must hold is that each id stays ONE path segment:
 * `a/../b` or `a?b` may not change which API route the call reaches.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const tagsGet = vi.fn();
const tagPost = vi.fn();
const tagDelete = vi.fn();
const getToken = vi.fn();
const requireToken = vi.fn();

vi.mock("~/lib/session.server", () => ({
  getToken: (...args: unknown[]) => getToken(...args),
  requireToken: (...args: unknown[]) => requireToken(...args),
}));
vi.mock("~/lib/api-client.server", () => ({
  createApi: vi.fn(() => ({
    inspections: {
      ":id": {
        tags: { $get: tagsGet },
        items: { ":itemId": { tags: { $post: tagPost, ":tagId": { $delete: tagDelete } } } },
      },
    },
  })),
}));

import { action, loader } from "./inspection-item-tags";
import { routeArgs } from "../../../tests/helpers/route-args";

const CONTEXT = {} as Parameters<typeof loader>[0]["context"];
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const HOSTILE = "x/../../admin?y=1#z";
const ENCODED = encodeURIComponent(HOSTILE);

function post(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return action(routeArgs(new Request("https://x/resources/inspection-item-tags", { method: "POST", body: fd }), { params: {}, context: CONTEXT }));
}

beforeEach(() => {
  vi.clearAllMocks();
  getToken.mockResolvedValue("tok");
  requireToken.mockResolvedValue("tok");
});

describe("inspection-item-tags relay", () => {
  it("reads the map for an inspection id sent as one encoded segment", async () => {
    tagsGet.mockResolvedValue(json({ data: { "item-1": [{ id: "t1", name: "Urgent", color: null }] } }));
    const url = `https://x/resources/inspection-item-tags?inspectionId=${encodeURIComponent(HOSTILE)}`;
    const out = await loader(routeArgs(new Request(url), { params: {}, context: CONTEXT }));
    expect(tagsGet).toHaveBeenCalledTimes(1);
    expect(tagsGet.mock.calls[0]![0]).toEqual({ param: { id: ENCODED } });
    expect(out).toEqual({ tags: { "item-1": [{ id: "t1", name: "Urgent" }] } });
  });

  it("adds a tag with every id encoded, and sends the tag id in the body", async () => {
    tagPost.mockResolvedValue(json({ success: true }));
    const out = await post({ intent: "add", inspectionId: HOSTILE, itemId: HOSTILE, tagId: "tag-1" });
    expect(tagPost).toHaveBeenCalledTimes(1);
    expect(tagPost.mock.calls[0]![0]).toEqual({ param: { id: ENCODED, itemId: ENCODED }, json: { tagId: "tag-1" } });
    expect(out).toEqual({ success: true });
  });

  it("removes a tag with all three ids encoded", async () => {
    tagDelete.mockResolvedValue(json({ success: true }));
    const out = await post({ intent: "remove", inspectionId: HOSTILE, itemId: HOSTILE, tagId: HOSTILE });
    expect(tagDelete).toHaveBeenCalledTimes(1);
    expect(tagDelete.mock.calls[0]![0]).toEqual({ param: { id: ENCODED, itemId: ENCODED, tagId: ENCODED } });
    expect(out).toEqual({ success: true });
  });

  it("leaves an ordinary id as it was", async () => {
    tagPost.mockResolvedValue(json({ success: true }));
    await post({ intent: "add", inspectionId: "insp-1", itemId: "item_9", tagId: "tag-1" });
    expect(tagPost.mock.calls[0]![0]).toEqual({ param: { id: "insp-1", itemId: "item_9" }, json: { tagId: "tag-1" } });
  });

  it("reports a refusal as not stored, and makes no call for a missing id", async () => {
    tagPost.mockResolvedValue(json({ success: false }, 404));
    expect(await post({ intent: "add", inspectionId: "i", itemId: "x", tagId: "t" })).toEqual({ success: false });
    tagPost.mockClear();
    expect(await post({ intent: "add", inspectionId: "i", itemId: "", tagId: "t" })).toMatchObject({ success: false });
    expect(tagPost).not.toHaveBeenCalled();
  });
});
