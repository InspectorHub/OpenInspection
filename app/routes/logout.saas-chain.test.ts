// @vitest-environment node
//
// Explicit sign-out in a hosted (portal-identity) deployment must also end the
// portal session. Clearing only the engine cookies sends the person to the
// portal login, which sees a live portal session and signs them straight back
// in. Only an EXPLICIT sign-out chains; session expiry does not.
import { describe, it, expect } from "vitest";
import { loader as logoutLoader } from "~/routes/logout";
import { requireToken } from "~/lib/session.server";
import { createLoadContext } from "~/lib/load-context";

type LoaderArgs = Parameters<typeof logoutLoader>[0];

const PORTAL = "https://portal.example.test";
const SAAS_ENV = { APP_MODE: "saas", PORTAL_API_URL: PORTAL } as const;

// The contract with the identity service's chained sign-out helper, written
// out literally on purpose: it must change together with that service, and a
// helper that mirrors the implementation could not catch a wrong path.
const SIGN_OUT_CONTRACT = "https://portal.example.test/api/account/logout?returnTo=%2Flogin%3Floggedout%3D1";
function expectedChain(env: Record<string, string>): string {
  expect(env.PORTAL_API_URL.replace(/\/$/, "")).toBe(PORTAL);
  return SIGN_OUT_CONTRACT;
}

function req(url: string, headers: Record<string, string> = {}): Request {
  return { url, headers: new Headers(headers) } as unknown as Request;
}

async function logout(env: Record<string, string>, url: string, headers: Record<string, string> = {}) {
  const res = await logoutLoader({
    request: req(url, headers),
    context: createLoadContext(env),
    params: {},
  } as unknown as LoaderArgs);
  return res as Response;
}

describe("staff sign-out chain", () => {
  it("saas: redirects to the portal logout helper with the encoded returnTo", async () => {
    const res = await logout(SAAS_ENV, "https://app.example.test/logout");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(expectedChain(SAAS_ENV));
    expect(res.headers.get("Location")).toContain("returnTo=%2Flogin%3Floggedout%3D1");
  });

  it("saas: a trailing slash on the base does not double up", async () => {
    const env = { ...SAAS_ENV, PORTAL_API_URL: `${PORTAL}/` };
    const res = await logout(env, "https://app.example.test/logout");
    expect(res.headers.get("Location")).toBe(expectedChain(env));
  });

  it("standalone: unchanged, ends at the local login", async () => {
    const res = await logout({ PORTAL_API_URL: PORTAL }, "https://app.example.test/logout");
    expect(res.headers.get("Location")).toBe("/login");
  });

  it("saas without a portal base: falls back to the local login", async () => {
    const res = await logout({ APP_MODE: "saas" }, "https://app.example.test/logout");
    expect(res.headers.get("Location")).toBe("/login");
  });

  it("cannot be steered by query parameters or the Host header", async () => {
    const res = await logout(
      SAAS_ENV,
      "https://evil.test/logout?returnTo=https://evil.test&base=https://evil.test&next=//evil.test",
      { Host: "evil.test", "X-Forwarded-Host": "evil.test", Origin: "https://evil.test" },
    );
    expect(res.headers.get("Location")).toBe(expectedChain(SAAS_ENV));
  });

  it("the agent sign-out never chains (agents have no portal identity)", async () => {
    const res = await logout(SAAS_ENV, "https://app.example.test/agent-logout");
    expect(res.headers.get("Location")).toBe("/agent-login");
  });

  it("session EXPIRY does not chain; it still lands on the local login", async () => {
    const payload = Buffer.from(JSON.stringify({ sub: "u1", exp: 1 })).toString("base64url");
    const head = Buffer.from(JSON.stringify({ alg: "ES256", kid: "v1" })).toString("base64url");
    let thrown: Response | undefined;
    try {
      await requireToken(
        createLoadContext(SAAS_ENV),
        req("https://app.example.test/inspections", {
          Cookie: `__Host-inspector_token=${head}.${payload}.sig`,
        }),
      );
    } catch (e) {
      thrown = e as Response;
    }
    expect(thrown?.headers.get("Location")).toBe("/login");
  });
});
