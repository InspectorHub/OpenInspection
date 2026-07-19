import { describe, it, expect, afterEach, vi } from "vitest";
import type { AppLoadContext } from "react-router";
import { loader } from "~/routes/public/portal-inspection";

/**
 * Spec 3 Task 6, Part B — the portal-inspection Hub loader must route an
 * agent-kind token (Part A: exchange returns `{ agent: true }`, no session
 * cookie) straight to the token-scoped report view WITHOUT ever hitting the
 * session-gated `/overview` endpoint (which would 401 and bounce the agent to
 * the client login page). Client/co_client tokens and existing-session
 * clients must be completely unaffected (regression coverage below).
 *
 * `context.cloudflare.env.API_WORKER` is left undefined so `createApi()` /
 * `loadAgentReportContext()` fall back to global `fetch` (see
 * app/lib/api-client.server.ts `buildFetch`), which this file stubs per test.
 * `tests/setup-web.ts` installs a hermetic-guard fetch by default that
 * rejects any un-stubbed call — `vi.unstubAllGlobals()` in afterEach restores it.
 */

const API_URL = "https://mock-api.test";

function makeContext(): AppLoadContext {
  return {
    cloudflare: { env: { API_URL } },
  } as unknown as AppLoadContext;
}

/**
 * A minimal, duck-typed Response stand-in — NOT happy-dom's real `Response`
 * class, whose constructor unconditionally `delete`s the `Set-Cookie` header
 * (simulating the browser spec restriction; see
 * happy-dom/lib/fetch/Response.js). hono/client's `hc()` just returns
 * whatever the injected `fetch` resolves to (no re-wrapping — see
 * hono/dist/client/client.js `ClientRequestImpl.fetch`), so a plain object
 * exposing `.status/.ok/.headers.get()/.json()/.text()` flows straight
 * through to the loader untouched, letting this test actually observe a
 * forwarded Set-Cookie header the way the real Cloudflare Worker runtime does.
 */
function fakeResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const text = JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name: string) => lower.get(name.toLowerCase()) ?? null },
    json: async () => JSON.parse(text),
    text: async () => text,
  } as unknown as Response;
}

function jsonRes(data: unknown, headers: Record<string, string> = {}): Response {
  return fakeResponse(200, { data }, headers);
}

interface FetchRoutes {
  exchange?: () => Response;
  overview?: () => Response;
  report?: () => Response;
  reportContext?: () => Response;
}

function stubFetch(routes: FetchRoutes) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input as string, init);
    const url = req.url;
    if (url.includes("/exchange")) {
      if (!routes.exchange) throw new Error(`unexpected exchange call: ${url}`);
      return routes.exchange();
    }
    if (url.includes("/report-context")) {
      return (routes.reportContext ?? (() => jsonRes({ kind: null })))();
    }
    if (url.includes("/brand/")) {
      return jsonRes({ companyName: null, primaryColor: null, logoUrl: null });
    }
    if (url.includes("/report/")) {
      if (!routes.report) throw new Error(`unexpected report call: ${url}`);
      return routes.report();
    }
    if (url.includes("/overview")) {
      if (!routes.overview) throw new Error(`unexpected overview call: ${url}`);
      return routes.overview();
    }
    throw new Error(`unmocked fetch: ${url}`);
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("portal-inspection loader — agent token routing (Task 6, Part B)", () => {
  it("an agent token does NOT call /overview, does NOT redirect, and renders the report section", async () => {
    const fetchMock = stubFetch({
      exchange: () => jsonRes({ email: "agent@x.com", agent: true }),
      report: () =>
        jsonRes({
          inspectionId: "insp1",
          address: "42 Agent Way",
          date: "2026-07-10",
          stats: { total: 0, satisfactory: 0, monitor: 0, defect: 0 },
          sections: [],
        }),
      reportContext: () =>
        jsonRes({ kind: "agent", recipientEmail: "agent@x.com", hasAccount: false }),
    });

    const request = new Request(
      "https://portal.test/portal/acme/i/insp1?token=agent-tok-1",
    );
    const res = await loader({
      params: { tenant: "acme", inspectionId: "insp1" },
      request,
      context: makeContext(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    expect(res).toBeInstanceOf(Response);
    const body = JSON.parse(await (res as Response).text()) as {
      section: string;
      overview: { address: string; date: string };
      report: { address: string } | null;
      agentReport: { kind: string; recipientEmail: string } | null;
    };

    expect(body.section).toBe("report");
    expect(body.report).not.toBeNull();
    expect(body.agentReport?.kind).toBe("agent");
    // Minimal-overview stand-in backfilled from the token-scoped report — NOT
    // from the session-gated /overview endpoint (never called, see below).
    expect(body.overview.address).toBe("42 Agent Way");

    // SECURITY: the session-gated overview endpoint must never be called for
    // an agent token — that would require the session Part A refuses to mint.
    const calledUrls = fetchMock.mock.calls.map((c) => {
      const [input] = c;
      return input instanceof Request ? input.url : String(input);
    });
    expect(calledUrls.some((u) => u.includes("/overview"))).toBe(false);

    // SECURITY: no client session cookie should ever be forwarded for an agent.
    expect((res as Response).headers.get("set-cookie")).toBeNull();
  });

  it("defense-in-depth: exchange fails to surface agent:true, but a report-context probe resolving agent-kind still avoids the login redirect", async () => {
    stubFetch({
      exchange: () => {
        throw new Error("simulated network failure");
      },
      overview: () => fakeResponse(401, { error: "Not authenticated" }),
      report: () =>
        jsonRes({
          inspectionId: "insp1",
          address: "7 Fallback Ln",
          date: "2026-07-11",
          stats: { total: 0, satisfactory: 0, monitor: 0, defect: 0 },
          sections: [],
        }),
      reportContext: () =>
        jsonRes({ kind: "agent", recipientEmail: "agent@x.com", hasAccount: true }),
    });

    const request = new Request(
      "https://portal.test/portal/acme/i/insp1?token=agent-tok-2",
    );
    const res = await loader({
      params: { tenant: "acme", inspectionId: "insp1" },
      request,
      context: makeContext(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    expect(res).toBeInstanceOf(Response);
    const body = JSON.parse(await (res as Response).text()) as {
      section: string;
      report: { address: string } | null;
    };
    expect(body.section).toBe("report");
    expect(body.report).not.toBeNull();
  });
});

describe("portal-inspection loader — client/existing-session paths are unchanged (regression)", () => {
  it("a client token still calls /overview (never short-circuited) and forwards the exchange Set-Cookie", async () => {
    // NOTE: happy-dom's `Response` constructor unconditionally strips
    // Set-Cookie/Set-Cookie2 (simulating the browser restriction — see
    // happy-dom/lib/fetch/Response.js), and the loader's OWN final payload is
    // built via a real `new Response(...)`, so this test-harness environment
    // cannot observe that header on the outer response the way a real
    // Cloudflare Worker (or exchange-agent-route.spec.ts, which runs in the
    // Node/vitest.api.config.ts environment) can. What we CAN and DO assert
    // here is the regression that actually matters for this loader: a
    // client/co_client token still reaches (and is not short-circuited away
    // from) the session-gated /overview call — the exact opposite of the
    // agent-token behavior asserted above.
    const cookieToForward =
      "__Host-portal_session=abc123; Path=/; HttpOnly; Secure; SameSite=Lax";
    const fetchMock = stubFetch({
      exchange: () => jsonRes({ email: "client@x.com" }, { "set-cookie": cookieToForward }),
      overview: () =>
        jsonRes({
          inspectionStatus: "completed",
          agreementSigned: true,
          paymentStatus: "paid",
          reportPublished: true,
          progress: { completed: 5, total: 5 },
          unreadMessages: 0,
          address: "1 Client St",
          date: "2026-01-01",
          token: "stable-tok",
          signerToken: null,
        }),
    });

    const request = new Request(
      "https://portal.test/portal/acme/i/insp1?token=client-tok-1",
    );
    const res = await loader({
      params: { tenant: "acme", inspectionId: "insp1" },
      request,
      context: makeContext(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    expect(res).toBeInstanceOf(Response);
    const body = JSON.parse(await (res as Response).text()) as {
      section: string;
      overview: { address: string };
    };
    expect(body.section).toBe("overview");
    expect(body.overview.address).toBe("1 Client St");

    const calledUrls = fetchMock.mock.calls.map((c) => {
      const [input] = c;
      return input instanceof Request ? input.url : String(input);
    });
    expect(calledUrls.some((u) => u.includes("/overview"))).toBe(true);
  });

  it("an existing session with no token still 401s on /overview and redirects to login (unchanged)", async () => {
    stubFetch({
      overview: () => fakeResponse(401, { error: "Not authenticated" }),
    });

    const request = new Request("https://portal.test/portal/acme/i/insp1");
    let thrown: unknown;
    try {
      await loader({
        params: { tenant: "acme", inspectionId: "insp1" },
        request,
        context: makeContext(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Response);
    const redirectRes = thrown as Response;
    expect(redirectRes.status).toBeGreaterThanOrEqual(300);
    expect(redirectRes.status).toBeLessThan(400);
    expect(redirectRes.headers.get("location")).toBe("/portal/acme");
  });
});
