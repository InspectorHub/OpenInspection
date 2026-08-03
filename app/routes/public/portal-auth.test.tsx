// @vitest-environment happy-dom
/**
 * Where a redeemed magic-link lands — and, for an agent, where it must NOT.
 *
 * Adding `?to=notifications` gave the redemption a second destination, and the
 * cheap way to write that is a ternary on the path. This spec exists because
 * one of the four answers is not a routing preference: an agent-resolved redeem
 * holds `__Host-inspector_token` and NO `__Host-portal_session`, so a `/portal/`
 * path handed to an agent is the exact confusion the agent branch was built to
 * prevent (server/api/portal.ts redeemRoute).
 */
import { describe, it, expect } from "vitest";
import { redeemDestination } from "./portal-auth";

describe("redeemDestination", () => {
  it("sends a client to the hub, and to notification settings when they asked for them", () => {
    expect(redeemDestination({ agent: false, wantsNotifications: false, tenant: "acme" }))
      .toBe("/portal/acme");
    expect(redeemDestination({ agent: false, wantsNotifications: true, tenant: "acme" }))
      .toBe("/portal/acme/notifications");
  });

  it("keeps an agent on agent surfaces in BOTH arms — never the client hub", () => {
    for (const wantsNotifications of [true, false]) {
      const dest = redeemDestination({ agent: true, wantsNotifications, tenant: "acme" });
      // The assertion that matters is the negative one. Pinning only the exact
      // string would keep passing if someone later "unified" the two branches.
      expect(dest.startsWith("/portal/"), String(wantsNotifications)).toBe(false);
      expect(dest.startsWith("/agent-"), String(wantsNotifications)).toBe(true);
    }
  });

  it("routes an agent who asked for notifications to their OWN settings, not the dashboard", () => {
    // Someone who clicked "manage notifications" in a privacy policy asked for
    // one thing. Dropping them on the dashboard is a link that lands one page
    // short of what it promised.
    expect(redeemDestination({ agent: true, wantsNotifications: true, tenant: "acme" }))
      .toBe("/agent-settings/profile");
    expect(redeemDestination({ agent: true, wantsNotifications: false, tenant: "acme" }))
      .toBe("/agent-dashboard");
  });
});
