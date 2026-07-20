import { describe, it, expect, afterEach, vi } from "vitest";
import type { AppLoadContext } from "react-router";
import { loader } from "~/routes/public/portal-auth";

/**
 * Spec 3 Task 7 — the portal-auth loader (BFF for GET /portal/:tenant/auth)
 * must route a redeem response with `{ agent: true }` (server/api/portal.ts
 * redeemRoute's new global-agent branch) to /agent-dashboard, forwarding the
 * __Host-inspector_token cookie the API minted — NEVER treat it as a client
 * portal session. Client/co_client redemption (no `agent` flag) is unchanged
 * (regression): redirect to /portal/:tenant forwarding __Host-portal_session.
 *
 * `context.cloudflare.env.API_WORKER` is left undefined so `createApi()`
 * falls back to global `fetch` (see app/lib/api-client.server.ts
 * `buildFetch`), which this file stubs per test. Mirrors the fake-Response
 * pattern in portal-inspection.test.ts (a plain duck-typed Response, NOT
 * happy-dom's real class, which strips Set-Cookie in its constructor).
 */

const API_URL = "https://mock-api.test";

function makeContext(): AppLoadContext {
  return {
    cloudflare: { env: { API_URL } },
  } as unknown as AppLoadContext;
}

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

function stubFetch(response: Response) {
  const mock = vi.fn(async () => response);
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeRequest(tenant: string, link: string | null) {
  const qs = link ? `?link=${encodeURIComponent(link)}` : "";
  return new Request(`https://app.test/portal/${tenant}/auth${qs}`);
}

describe("portal-auth loader — find-my-report redeem destination", () => {
  // NOTE: happy-dom's `Response` constructor unconditionally strips
  // Set-Cookie/Set-Cookie2 (simulating the browser restriction — see
  // happy-dom/lib/fetch/Response.js), and the loader's `redirect()` builds its
  // final payload via a real `new Response(...)`, so this test-harness
  // environment cannot observe the forwarded header on the OUTER response the
  // way a real Cloudflare Worker (or find-my-report-agent-dest.spec.ts, which
  // runs in the Node/vitest.api.config.ts environment and asserts the API's
  // own Set-Cookie directly) can — see the identical caveat in
  // portal-inspection.test.ts. What we assert here is the destination
  // branch — the loader's actual job — which IS observable.
  it("agent redeem ({ agent: true }) -> redirects to /agent-dashboard", async () => {
    stubFetch(fakeResponse(
      200,
      { data: { email: "agent@example.com", agent: true } },
      { "set-cookie": "__Host-inspector_token=abc; Path=/; HttpOnly; Secure; SameSite=Strict" },
    ));

    const result = await loader({
      params: { tenant: "acme" },
      request: makeRequest("acme", "sometoken"),
      context: makeContext(),
    } as never);

    expect(result).toBeInstanceOf(Response);
    const res = result as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/agent-dashboard");
  });

  it("regression: client redeem (no agent flag) -> redirects to /portal/:tenant (unchanged)", async () => {
    stubFetch(fakeResponse(
      200,
      { data: { email: "client@example.com" } },
      { "set-cookie": "__Host-portal_session=xyz; Path=/; HttpOnly; Secure; SameSite=Lax" },
    ));

    const result = await loader({
      params: { tenant: "acme" },
      request: makeRequest("acme", "sometoken"),
      context: makeContext(),
    } as never);

    expect(result).toBeInstanceOf(Response);
    const res = result as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/portal/acme");
  });

  it("regression: invalid/expired link (401) -> expired state, no redirect", async () => {
    stubFetch(fakeResponse(401, { error: "Invalid or expired link" }));

    const result = await loader({
      params: { tenant: "acme" },
      request: makeRequest("acme", "badtoken"),
      context: makeContext(),
    } as never);

    expect(result).toEqual({ expired: true, tenant: "acme" });
  });

  it("missing link -> redirects to /portal/:tenant without calling the API", async () => {
    const fetchMock = stubFetch(fakeResponse(200, {}));

    let thrown: unknown;
    try {
      await loader({
        params: { tenant: "acme" },
        request: makeRequest("acme", null),
        context: makeContext(),
      } as never);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).headers.get("location")).toBe("/portal/acme");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
