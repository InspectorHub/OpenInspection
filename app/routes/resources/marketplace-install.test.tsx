// @vitest-environment happy-dom
/**
 * IA-39 — the marketplace-install resource route action forwards to the
 * import endpoint via the token-relay API client and surfaces the new local
 * template id (or a clean error) to the caller.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const importPost = vi.fn();

vi.mock("~/lib/session.server", () => ({
  requireToken: vi.fn().mockResolvedValue("tok"),
}));
vi.mock("~/lib/api-client.server", () => ({
  createApi: vi.fn(() => ({ marketplace: { ":id": { import: { $post: importPost } } } })),
}));

import { action } from "./marketplace-install";

function post(fields: Record<string, string>) {
  const body = new URLSearchParams(fields);
  const request = new Request("https://x/resources/marketplace-install", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return action({ request, params: {}, context: {} as any });
}

describe("marketplace-install action", () => {
  beforeEach(() => importPost.mockReset());

  it("imports the template and returns the new local id", async () => {
    importPost.mockResolvedValue(new Response(JSON.stringify({ data: { localTemplateId: "tpl-local-1" } }), { status: 201 }));
    const res = await post({ templateId: "mkt-1" });
    expect(importPost).toHaveBeenCalledWith({ param: { id: "mkt-1" } });
    expect(res).toEqual({ ok: true, localTemplateId: "tpl-local-1" });
  });

  it("returns an error when the import endpoint fails", async () => {
    importPost.mockResolvedValue(new Response("nope", { status: 500 }));
    const res = await post({ templateId: "mkt-1" });
    expect(res).toMatchObject({ ok: false });
  });

  it("rejects a missing template id without calling the endpoint", async () => {
    const res = await post({});
    expect(importPost).not.toHaveBeenCalled();
    expect(res).toMatchObject({ ok: false });
  });
});
