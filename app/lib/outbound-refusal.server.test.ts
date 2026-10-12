import { describe, it, expect } from "vitest";
import { humanCheckSiteKey } from "./outbound-refusal.server";

const refusal = (status: number, code: string, details: unknown) =>
  new Response(JSON.stringify({ success: false, error: { code, message: "x", details } }), { status });

describe("humanCheckSiteKey", () => {
  it("returns the site key for the cooling-window refusal", async () => {
    expect(await humanCheckSiteKey(refusal(403, "OUTBOUND_COOLING_WINDOW", { turnstileSiteKey: "k1" }))).toBe("k1");
  });
  it("returns null for any other refusal, status or unreadable body", async () => {
    expect(await humanCheckSiteKey(refusal(403, "FORBIDDEN", { turnstileSiteKey: "k1" }))).toBeNull();
    expect(await humanCheckSiteKey(refusal(429, "OUTBOUND_COOLING_WINDOW", { turnstileSiteKey: "k1" }))).toBeNull();
    expect(await humanCheckSiteKey(new Response("not json", { status: 403 }))).toBeNull();
    expect(await humanCheckSiteKey(refusal(403, "OUTBOUND_COOLING_WINDOW", {}))).toBeNull();
  });
});
