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
import { routeArgs } from "../../../tests/helpers/route-args";
/** Minimal AppLoadContext stub — the route only forwards it to createApi. */
const CONTEXT = {} as Parameters<typeof action>[0]["context"];

function post(fields: Record<string, string>) {
  const body = new URLSearchParams(fields);
  const request = new Request("https://x/resources/marketplace-install", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  return action(routeArgs(request, { params: {}, context: CONTEXT }));
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

  it("relays the server's own refusal instead of a generic retry sentence", async () => {
    // The refusal that matters is a statutory package whose authority PDF is not
    // in storage: the message names the upload endpoint, the revision and where
    // the authority publishes the file, and it is the only place a self-hosted
    // operator is told any of that. It also contradicts "please try again" —
    // retrying installs nothing until the file exists.
    importPost.mockResolvedValue(new Response(
      JSON.stringify({ success: false, error: { message: 'This package needs the official file first. Upload it at POST /api/admin/statutory-forms/tx_trec_rei/source' } }),
      { status: 409, headers: { 'content-type': 'application/json' } },
    ));
    const res = await post({ templateId: "mkt-1" });
    expect(res).toMatchObject({ ok: false });
    expect((res as { error: string }).error).toContain("/api/admin/statutory-forms/");
  });

  it("invents no sentence when the refusal carries no message", async () => {
    // The control for the test above. Without it, a route that returned the
    // relayed message for EVERY refusal — including one whose body is an HTML
    // error page — would pass the relay test just as happily, and the reader
    // would get "<html>502</html>" in a banner. Left undefined here on purpose:
    // the page owns the fallback, in the message catalogue where it can be
    // translated.
    importPost.mockResolvedValue(new Response("<html>502</html>", { status: 502 }));
    const res = await post({ templateId: "mkt-1" });
    expect(res).toMatchObject({ ok: false });
    expect((res as { error?: string }).error).toBeUndefined();
  });

  it("rejects a missing template id without calling the endpoint", async () => {
    const res = await post({});
    expect(importPost).not.toHaveBeenCalled();
    expect(res).toMatchObject({ ok: false });
  });
});
