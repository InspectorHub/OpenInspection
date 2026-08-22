/**
 * The half of the agent-terms gate that lives in the app tier.
 *
 * The gate itself is server-side and authoritative
 * (`server/lib/middleware/agent-terms-gate.ts`, pinned by
 * `tests/unit/legal/agent-terms-gate.spec.ts`). This is only the translation of
 * its 428 into a redirect — but it signals by THROWING, and the loader that
 * calls it wraps its API reads in a `catch` that exists to make a failed
 * timezone read non-fatal. A throw swallowed there leaves a gated agent sitting
 * on a data-less page instead of on the one screen that fixes it, so the
 * behaviour worth pinning is that this really does throw, and really does not
 * throw for anything else.
 */
import { describe, it, expect } from "vitest";
import { throwIfAgentTermsRequired } from "./agent-terms.server";

const REQUEST = new Request("https://x.test/agent-repair-items?filter=open");

function gateRefusal(details: Record<string, unknown> = { acceptPath: "/agent-accept-terms" }) {
  return new Response(
    JSON.stringify({ success: false, error: { code: "AGENT_TERMS_REQUIRED", message: "no", details } }),
    { status: 428, headers: { "content-type": "application/json" } },
  );
}

describe("throwIfAgentTermsRequired", () => {
  it("redirects to the accept page, carrying where the agent was going", async () => {
    let thrown: unknown;
    try {
      await throwIfAgentTermsRequired(gateRefusal(), REQUEST);
    } catch (err) {
      thrown = err;
    }
    // Positive control on the assertion itself: a value that is not a Response
    // must not satisfy it, or "nothing was thrown" would read as a pass.
    expect(thrown instanceof Response).toBe(true);
    const res = thrown as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "/agent-accept-terms?returnTo=" + encodeURIComponent("/agent-repair-items?filter=open"),
    );
  });

  // Found in Chrome, not here — the suite above only ever built page URLs, so it
  // could not see this. Every agent page runs `agent-layout`'s loader, and React
  // Router calls that loader through a DATA request whose path is
  // `/agent-dashboard.data`. The gate refuses that request, and the refusal used
  // to carry the data path into `returnTo` verbatim. Accepting then redirected
  // the agent to `/agent-dashboard.data`, which renders a 404 — so the one screen
  // that unblocks them dead-ended every single time it fired.
  it("returns the agent to a PAGE, not to React Router's .data payload", async () => {
    const dataRequest = new Request(
      "https://x.test/agent-dashboard.data?_routes=routes%2Fagent-layout",
    );
    let thrown: Response | undefined;
    try {
      await throwIfAgentTermsRequired(gateRefusal(), dataRequest);
    } catch (err) {
      thrown = err as Response;
    }
    expect(thrown?.headers.get("location")).toBe(
      "/agent-accept-terms?returnTo=" + encodeURIComponent("/agent-dashboard"),
    );
  });

  // The positive control for the one above: a real page path that merely ENDS in
  // something data-ish must survive untouched. A fix that strips too eagerly
  // would pass the test above and quietly break ordinary navigation.
  it("leaves a genuine page path alone, including its query", async () => {
    const pageRequest = new Request("https://x.test/agent-reports/metadata?tab=sent");
    let thrown: Response | undefined;
    try {
      await throwIfAgentTermsRequired(gateRefusal(), pageRequest);
    } catch (err) {
      thrown = err as Response;
    }
    expect(thrown?.headers.get("location")).toBe(
      "/agent-accept-terms?returnTo=" + encodeURIComponent("/agent-reports/metadata?tab=sent"),
    );
  });

  it("follows the path the refusal names rather than assuming one", async () => {
    let thrown: Response | undefined;
    try {
      await throwIfAgentTermsRequired(gateRefusal({ acceptPath: "/agent-terms-elsewhere" }), REQUEST);
    } catch (err) {
      thrown = err as Response;
    }
    expect(thrown?.headers.get("location")).toMatch(/^\/agent-terms-elsewhere\?/);
  });

  it("does nothing for a successful response", async () => {
    const ok = new Response(JSON.stringify({ success: true }), { status: 200 });
    await expect(throwIfAgentTermsRequired(ok, REQUEST)).resolves.toBeUndefined();
  });

  it("does nothing for an unrelated failure — 401 is not this", async () => {
    const unauthorized = new Response(JSON.stringify({ success: false }), { status: 401 });
    await expect(throwIfAgentTermsRequired(unauthorized, REQUEST)).resolves.toBeUndefined();
  });

  it("does nothing for a 428 that is NOT the agent-terms gate", async () => {
    // The status is checked AND the code is read. 428 means one thing in this
    // API today; reading the code is what keeps this correct on the day it
    // means two, instead of sending someone to a consent screen for an
    // unrelated precondition.
    const other = new Response(
      JSON.stringify({ success: false, error: { code: "SOMETHING_ELSE" } }),
      { status: 428, headers: { "content-type": "application/json" } },
    );
    await expect(throwIfAgentTermsRequired(other, REQUEST)).resolves.toBeUndefined();
  });
});
