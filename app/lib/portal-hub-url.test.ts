import { describe, it, expect } from "vitest";
import { portalHubUrl } from "~/lib/portal-hub-url";

describe("portalHubUrl (IA-44 payment-track hand-off)", () => {
  it("carries the portal token so the Hub can mint a session", () => {
    expect(portalHubUrl({ tenant: "acme", inspectionId: "i1", token: "tok1", section: "report" }))
      .toBe("/portal/acme/i/i1?section=report&token=tok1");
  });

  it("percent-encodes a token with URL-unsafe characters", () => {
    expect(portalHubUrl({ tenant: "acme", inspectionId: "i1", token: "a+b/c=", section: "payment" }))
      .toBe("/portal/acme/i/i1?section=payment&token=a%2Bb%2Fc%3D");
  });

  it("propagates the Stripe post-redirect marker so the Hub keeps the optimistic state", () => {
    expect(portalHubUrl({ tenant: "acme", inspectionId: "i1", token: "t", section: "payment", justPaid: true }))
      .toBe("/portal/acme/i/i1?section=payment&token=t&redirect_status=succeeded");
  });

  it("omits an absent token (an existing session still authenticates the Hub)", () => {
    expect(portalHubUrl({ tenant: "acme", inspectionId: "i1", token: null }))
      .toBe("/portal/acme/i/i1");
  });
});
