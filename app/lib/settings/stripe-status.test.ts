import { describe, it, expect } from "vitest";
import { stripeStatusFrom, stripeStatusFromResponse } from "./stripe-status";

const overview = (status: unknown) => ({ data: [{ id: "calendar", status: "connected" }, { id: "stripe", status }] });
const ok = (body: unknown) => ({ ok: true, json: async () => body });

describe("stripeStatusFrom", () => {
  it.each(["connected", "attention", "not_connected"] as const)("reads %s from the stripe card", (status) => {
    expect(stripeStatusFrom(overview(status))).toBe(status);
  });
  it("reads anything the overview did not say as unknown, never connected", () => {
    expect(stripeStatusFrom(overview("weird"))).toBe("unknown");
    expect(stripeStatusFrom({ data: [{ id: "calendar", status: "connected" }] })).toBe("unknown");
    expect(stripeStatusFrom({ data: "x" })).toBe("unknown");
    expect(stripeStatusFrom(null)).toBe("unknown");
  });
});

describe("stripeStatusFromResponse: the overview request failing must not take the page down", () => {
  it("positive control: a healthy response is read", async () => {
    expect(await stripeStatusFromResponse(ok(overview("attention")))).toBe("attention");
  });
  it("no response (the request threw and was caught) is unknown", async () => {
    expect(await stripeStatusFromResponse(null)).toBe("unknown");
  });
  it("a non-OK response is unknown", async () => {
    expect(await stripeStatusFromResponse({ ok: false, json: async () => overview("connected") })).toBe("unknown");
  });
  it("a 200 whose body is not JSON is unknown, not a thrown error", async () => {
    expect(await stripeStatusFromResponse({ ok: true, json: async () => { throw new SyntaxError("bad json"); } })).toBe("unknown");
  });
});
