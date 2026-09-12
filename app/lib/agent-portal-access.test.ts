/**
 * F69 — who the agent portal admits.
 *
 * The enforcement is `requireRole('agent')` on every `/api/agent/*` route
 * (server/api/agent.ts, pinned by tests/unit/agent/agent-portal-role-gate.spec.ts).
 * This is the app tier OBEYING that answer, which is the half that was missing:
 * `requireToken` proves a session exists, and for every `/agent-*` page that was
 * the whole admission rule, so a signed-in inspector who typed
 * `/agent-dashboard` was served the portal shell.
 *
 * Every test here carries its opposite, because a guard that refuses everybody
 * passes a one-sided suite.
 */
import { describe, it, expect } from "vitest";
import { throwIfNotAgent } from "./agent-portal-access.server";

function thrownBy(fn: () => void): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return undefined;
}

describe("throwIfNotAgent", () => {
  it("refuses a 403 — a signed-in non-agent — and sends them to the staff app", () => {
    const thrown = thrownBy(() => throwIfNotAgent({ status: 403 }));
    // Positive control on the assertion itself: "nothing was thrown" must not
    // read as a pass.
    expect(thrown instanceof Response).toBe(true);
    const res = thrown as Response;
    expect(res.status).toBe(302);
    // `/` resolves to /inspections for a token holder (routes/home.tsx). NOT
    // /agent-login: that would invite a working staff session to replace itself
    // with one this person does not have.
    expect(res.headers.get("location")).toBe("/");
  });

  it("ADMITS a 200 — the control, without which refusing everyone would pass", () => {
    expect(thrownBy(() => throwIfNotAgent({ status: 200 }))).toBeUndefined();
  });

  it("sends a 401 to the agent door, which needs no session and cannot loop", () => {
    const res = thrownBy(() => throwIfNotAgent({ status: 401 })) as Response;
    expect(res instanceof Response).toBe(true);
    expect(res.headers.get("location")).toBe("/agent-login");
  });

  it("refuses when there is no answer at all, as 503 rather than a redirect", () => {
    // The in-process call threw, so there IS no decision to obey. Previously this
    // was read as "not an agent yet, carry on" — the one reading that admits
    // everybody exactly when the decision is unavailable. It is not a redirect
    // because every destination is wrong when what failed is "who is this".
    const res = thrownBy(() => throwIfNotAgent(null)) as Response;
    expect(res instanceof Response).toBe(true);
    expect(res.status).toBe(503);
  });

  it("passes a 404 through: a missing profile row is a broken record, not the wrong audience", () => {
    expect(thrownBy(() => throwIfNotAgent({ status: 404 }))).toBeUndefined();
  });

  it("passes a 428 through, so the agent-terms redirect still gets to run", () => {
    expect(thrownBy(() => throwIfNotAgent({ status: 428 }))).toBeUndefined();
  });
});
