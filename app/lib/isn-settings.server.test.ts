/**
 * The ISN panel's save: which credentials are sent. A blank credential field
 * means "unchanged" (SecretField shows a mask and submits nothing new), so it
 * must not be sent as an empty value.
 */
import { describe, expect, it, vi } from "vitest";
import type { Api } from "./api-client.server";
import { saveIsnSettings } from "./isn-settings.server";

function fakeApi(ok = true) {
  const put = vi.fn(() => Promise.resolve(new Response(JSON.stringify(ok ? { success: true } : { error: { message: "ISN_DOMAIN must be https://", field: "ISN_DOMAIN" } }), { status: ok ? 200 : 400 })));
  const api = { secrets: { secrets: { $put: put } } } as unknown as Api;
  return { api, put };
}

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("saveIsnSettings", () => {
  it("sends only the credentials that were typed", async () => {
    const { api, put } = fakeApi();
    const out = await saveIsnSettings(api, form({ ISN_DOMAIN: "https://inspectionsupport.com", ISN_ACCESS_KEY: "  " }));
    expect(out.success).toBe(true);
    expect(put).toHaveBeenCalledWith({ json: { ISN_DOMAIN: "https://inspectionsupport.com" } });
  });

  it("skips the secrets call when nothing was typed", async () => {
    const { api, put } = fakeApi();
    expect((await saveIsnSettings(api, form({}))).success).toBe(true);
    expect(put).not.toHaveBeenCalled();
  });

  it("returns the server's refusal against its field", async () => {
    const { api } = fakeApi(false);
    const out = await saveIsnSettings(api, form({ ISN_DOMAIN: "inspectionsupport.com" }));
    expect(out).toMatchObject({ success: false, error: "ISN_DOMAIN must be https://", field: "ISN_DOMAIN" });
  });
});
