// @vitest-environment happy-dom
/**
 * The uninstall resource route forwards to the un-import endpoint through the
 * token-relay API client, and reports a refusal as a refusal.
 *
 * The last assertion is the one with teeth: the service method behind this had
 * no caller at all until this route existed, and a BFF that defaulted a failed
 * call to `ok: true` would put the same gap back in a shape nobody could see —
 * the page would show a pack as removed while every row it created was still
 * there.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const uninstallPost = vi.fn();

vi.mock("~/lib/session.server", () => ({
  requireToken: vi.fn().mockResolvedValue("tok"),
}));
vi.mock("~/lib/api-client.server", () => ({
  createApi: vi.fn(() => ({ marketplace: { ":id": { uninstall: { $post: uninstallPost } } } })),
}));

import { action } from "./marketplace-uninstall";
import { routeArgs } from "../../../tests/helpers/route-args";
/** Minimal AppLoadContext stub — the route only forwards it to createApi. */
const CONTEXT = {} as Parameters<typeof action>[0]["context"];

function post(fields: Record<string, string>) {
  const body = new URLSearchParams(fields);
  const request = new Request("https://x/resources/marketplace-uninstall", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  return action(routeArgs(request, { params: {}, context: CONTEXT }));
}

describe("marketplace-uninstall action", () => {
  beforeEach(() => uninstallPost.mockReset());

  it("un-installs the entry and reports what it removed", async () => {
    uninstallPost.mockResolvedValue(new Response(
      JSON.stringify({ data: { kind: "statutory", rowsAffected: 1 } }),
      { status: 200 },
    ));
    const res = await post({ libraryId: "mkt-1" });
    expect(uninstallPost).toHaveBeenCalledWith({ param: { id: "mkt-1" } });
    expect(res).toEqual({ ok: true, kind: "statutory", rowsAffected: 1 });
  });

  it("reports a refusal rather than defaulting it to success", async () => {
    uninstallPost.mockResolvedValue(new Response("already uninstalled", { status: 400 }));
    const res = await post({ libraryId: "mkt-1" });
    expect(res).toMatchObject({ ok: false });
  });

  it("rejects a missing id without calling the endpoint", async () => {
    const res = await post({});
    expect(uninstallPost).not.toHaveBeenCalled();
    expect(res).toMatchObject({ ok: false });
  });
});
