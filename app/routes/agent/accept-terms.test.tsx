/**
 * Where an agent lands after accepting the agent terms.
 *
 * This is the one security-bearing pure function on the accept page: the target
 * arrives as a query parameter and again as a hidden form field, and it is
 * honoured immediately after a consent — so an attacker-shaped value here is an
 * authenticated open redirect at the least convenient possible moment.
 *
 * Two rules stack. `safeReturnTo` (shared with signup and the SSO handoff) keeps
 * it same-origin; this narrows further to the agent surface, because every agent
 * page is mounted under the `agent-` prefix and anything else is either a staff
 * page they cannot open or somewhere unexpected to be dropped.
 */
import { describe, it, expect } from "vitest";
import { agentReturnTo } from "./accept-terms";

const DEFAULT = "/agent-dashboard";

describe("agentReturnTo", () => {
  it("keeps a real agent destination", () => {
    // Positive control first: if this one did not pass through, every
    // assertion below would be satisfied by a function that returns the
    // fallback unconditionally.
    expect(agentReturnTo("/agent-repair-items?filter=open")).toBe("/agent-repair-items?filter=open");
  });

  it.each([
    ["nothing at all", null],
    ["an absolute URL", "https://evil.test/agent-dashboard"],
    ["a protocol-relative URL", "//evil.test/agent-dashboard"],
    ["a backslash trick some browsers read as //", "/\\evil.test"],
    ["a javascript: payload", "javascript:alert(1)"],
    ["a staff page", "/inspections"],
    ["a staff page that merely mentions agents", "/contacts?type=agent"],
  ])("falls back for %s", (_label, raw) => {
    expect(agentReturnTo(raw)).toBe(DEFAULT);
  });

  it("refuses to return to itself — that reads as the acceptance having failed", () => {
    expect(agentReturnTo("/agent-accept-terms")).toBe(DEFAULT);
    expect(agentReturnTo("/agent-accept-terms?returnTo=/agent-dashboard")).toBe(DEFAULT);
  });
});
