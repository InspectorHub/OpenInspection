/**
 * Removing a date override relays the server's own reason when it refuses (403
 * for a colleague's row, 409 for a synced one) so the alert can say why instead
 * of a generic "could not be removed". Anything else stays generic.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const del = vi.hoisted(() => vi.fn());
vi.mock("~/lib/session.server", () => ({ requireToken: vi.fn(async () => "tok") }));
vi.mock("~/lib/api-client.server", () => ({
  createApi: () => ({ availability: { overrides: { ":id": { $delete: del } } } }),
}));

import { action } from "~/routes/settings-schedule";

const call = async () => {
  const body = new URLSearchParams({ intent: "override-remove", id: "o1" });
  const request = new Request("http://localhost/settings/schedule", { method: "POST", body });
  return (await action({ request, context: {}, params: {} } as never)) as { ok: boolean; intent: string; message?: string | null };
};
const refuse = (status: number, message?: string) =>
  new Response(JSON.stringify({ success: false, error: message ? { message } : undefined }), { status, headers: { "content-type": "application/json" } });

beforeEach(() => del.mockReset());

describe("settings schedule: override-remove", () => {
  it("a removal that succeeds answers ok", async () => {
    del.mockResolvedValue(new Response("{}", { status: 200 }));
    expect(await call()).toEqual({ ok: true, intent: "override-remove" });
  });

  it.each([[403, "You can only manage your own availability"], [409, "Synced from Google. Change it in your calendar."]])("relays the server reason for a %s", async (status, reason) => {
    del.mockResolvedValue(refuse(status, reason));
    expect(await call()).toEqual({ ok: false, intent: "override-remove", message: reason });
  });

  it.each([[500, "Internal detail"], [404, "Not found"]])("does not relay a %s (the page's own wording is used)", async (status, reason) => {
    del.mockResolvedValue(refuse(status, reason));
    expect(await call()).toEqual({ ok: false, intent: "override-remove", message: null });
  });

  it("a 403 with no readable body falls back to the generic wording", async () => {
    del.mockResolvedValue(new Response("nope", { status: 403 }));
    expect(await call()).toEqual({ ok: false, intent: "override-remove", message: null });
  });
});
