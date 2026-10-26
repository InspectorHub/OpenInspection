// @vitest-environment node
// A browser can hold a session cookie whose JWT has expired (JWT life is 24h, the cookie's is
// longer) or has been revoked. /oauth/authorize answers such a cookie by sending the browser to
// /login with returnTo=<the authorize URL>, and /login used to answer ANY token by sending the
// browser back to returnTo: an endless redirect (ERR_TOO_MANY_REDIRECTS) that only clearing the
// browser's cookies could end. These specs use the REAL session helpers (only the in-process API
// client is faked) so the cookies are the ones a browser would hold and receive.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { loader as authorizeLoader, action as authorizeAction } from "~/routes/oauth/authorize";
import { loader as loginLoader } from "~/routes/login";
import { createSessionWithToken } from "~/lib/session.server";
import { createLoadContext } from "~/lib/load-context";

const sessionGet = vi.hoisted(() => vi.fn());
vi.mock("~/lib/api-client.server", () => ({
  createApi: () => ({ sessionContext: { context: { $get: sessionGet } } }),
}));
vi.mock("../../../server/lib/audit", () => ({ writeAuditLog: vi.fn() }));

const ORIGIN = "https://app.test";
const AUTHORIZE_PATH = "/oauth/authorize?response_type=code&client_id=c1&scope=native&app=x";

const b64url = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function jwt(expSecondsFromNow: number): string {
  const exp = Math.floor(Date.now() / 1000) + expSecondsFromNow;
  return `${b64url({ alg: "ES256", kid: "v1" })}.${b64url({ sub: "u1", "custom:tenantId": "t1", exp })}.sig`;
}
const EXPIRED = () => jwt(-3600);
const LIVE = () => jwt(3600);

function envFor() {
  const provider = {
    parseAuthRequest: vi.fn(async () => ({ responseType: "code", clientId: "c1", scope: ["native"], redirectUri: "io.example.app:/cb", state: "s", codeChallenge: "c".repeat(43), codeChallengeMethod: "S256" })),
    lookupClient: vi.fn(async () => ({ clientId: "c1", clientName: "App", redirectUris: ["io.example.app:/cb"] })),
    completeAuthorization: vi.fn(),
  };
  // A variable, not a literal: OAUTH_PROVIDER is injected at runtime and is not part of WorkerEnv.
  const env = { APP_MODE: "standalone", SESSION_SECRET: "test-session-secret", OAUTH_PROVIDER: provider, MCP_ENABLED: "true", NATIVE_CLIENT_ENABLED: "true" };
  return createLoadContext(env);
}
type Ctx = ReturnType<typeof envFor>;

/** The Cookie header a browser would send: the __session cookie plus the raw JWT cookie. */
async function browserCookies(context: Ctx, token: string): Promise<Map<string, string>> {
  const res = await createSessionWithToken(context, token, "/");
  return applySetCookies(new Map(), res.headers.getSetCookie());
}

/** What a browser does with Set-Cookie: keep a live value, drop a cookie that is cleared. */
function applySetCookies(jar: Map<string, string>, setCookies: string[]): Map<string, string> {
  const next = new Map(jar);
  for (const line of setCookies) {
    const [pair = "", ...attrs] = line.split(/;\s*/);
    const eq = pair.indexOf("=");
    const name = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    const dead = value === "" || attrs.some((a) => /^max-age=0$/i.test(a)) || attrs.some((a) => /^expires=.*1970/i.test(a));
    if (dead) next.delete(name);
    else next.set(name, value);
  }
  return next;
}
const cookieHeader = (jar: Map<string, string>) => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

function authorizeGet(context: Ctx, jar: Map<string, string>, path = AUTHORIZE_PATH) {
  const url = new URL(path, ORIGIN);
  return { request: new Request(url, { headers: { Cookie: cookieHeader(jar) } }), url, context } as never;
}
function authorizePost(context: Ctx, jar: Map<string, string>) {
  const url = new URL("/oauth/authorize?scope=native", ORIGIN);
  const body = new URLSearchParams({ oauthReq: "{}" });
  return { request: new Request(url, { method: "POST", body, headers: { Cookie: cookieHeader(jar) } }), url, context } as never;
}
function loginGet(context: Ctx, jar: Map<string, string>, returnTo: string) {
  const url = new URL(`/login?app=1&returnTo=${encodeURIComponent(returnTo)}`, ORIGIN);
  return { request: new Request(url, { headers: { Cookie: cookieHeader(jar) } }), url, context, params: {} } as never;
}

const thrown = async (p: Promise<unknown>): Promise<Response> => {
  const out = await p.then((v) => v, (e: unknown) => e);
  expect(out).toBeInstanceOf(Response);
  return out as Response;
};
const clears = (res: Response, name: string) => res.headers.getSetCookie().some((c) => c.startsWith(`${name}=;`));

beforeEach(() => {
  // The API refuses a dead token; a live one resolves to an inspector.
  sessionGet.mockReset().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
});

describe("login loader with a stale session cookie", () => {
  it("renders the login page for an EXPIRED token instead of redirecting to returnTo", async () => {
    const context = envFor();
    const jar = await browserCookies(context, EXPIRED());
    const out = await loginLoader(loginGet(context, jar, AUTHORIZE_PATH));
    expect(out).not.toBeInstanceOf(Response);
    expect(out).toEqual({ returnTo: AUTHORIZE_PATH, app: true });
  });

  it("control: a LIVE token still redirects to the same-origin returnTo", async () => {
    const context = envFor();
    const jar = await browserCookies(context, LIVE());
    const out = (await loginLoader(loginGet(context, jar, AUTHORIZE_PATH))) as Response;
    expect(out).toBeInstanceOf(Response);
    expect(out.status).toBe(302);
    expect(out.headers.get("Location")).toBe(AUTHORIZE_PATH);
  });

  it("control: an unsafe returnTo is still not followed for a live token", async () => {
    const context = envFor();
    const jar = await browserCookies(context, LIVE());
    const out = (await loginLoader(loginGet(context, jar, "https://evil.example/x"))) as Response;
    expect(out.headers.get("Location")).toBe("/inspections");
  });

  it("control: no cookie renders the login page", async () => {
    const out = await loginLoader(loginGet(envFor(), new Map(), AUTHORIZE_PATH));
    expect(out).toEqual({ returnTo: AUTHORIZE_PATH, app: true });
  });
});

describe("authorize with a token whose identity cannot be resolved", () => {
  for (const [label, token] of [["expired", EXPIRED], ["unexpired but rejected by the API", LIVE]] as const) {
    it(`loader: ${label} => 302 to /login that clears both session cookies and keeps returnTo`, async () => {
      const context = envFor();
      const jar = await browserCookies(context, token());
      const res = await thrown(authorizeLoader(authorizeGet(context, jar)));
      expect(res.status).toBe(302);
      const location = new URL(res.headers.get("Location") ?? "", ORIGIN);
      expect(location.pathname).toBe("/login");
      expect(location.searchParams.get("app")).toBe("1");
      expect(location.searchParams.get("returnTo")).toBe(AUTHORIZE_PATH);
      expect(clears(res, "__session")).toBe(true);
      expect(clears(res, "__Host-inspector_token")).toBe(true);
    });

    it(`action: ${label} => the same clearing redirect`, async () => {
      const context = envFor();
      const jar = await browserCookies(context, token());
      const res = await thrown(authorizeAction(authorizePost(context, jar)));
      expect(res.status).toBe(302);
      expect(new URL(res.headers.get("Location") ?? "", ORIGIN).pathname).toBe("/login");
      expect(clears(res, "__session")).toBe(true);
      expect(clears(res, "__Host-inspector_token")).toBe(true);
    });
  }

  it("control: no token at all redirects to /login without touching cookies", async () => {
    const res = await thrown(authorizeLoader(authorizeGet(envFor(), new Map())));
    expect(res.status).toBe(302);
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it("control: a token the API accepts reaches the consent page (no redirect, no cookie change)", async () => {
    sessionGet.mockResolvedValue({ ok: true, json: async () => ({ data: { user: { role: "inspector" }, branding: { tenantSlug: "acme" } } }) });
    const context = envFor();
    const jar = await browserCookies(context, LIVE());
    const out = await authorizeLoader(authorizeGet(context, jar));
    expect(out).toMatchObject({ native: true, role: "inspector" });
  });
});

describe("the redirect chain from an expired cookie", () => {
  it("ends on the login page within three hops", async () => {
    const context = envFor();
    let jar = await browserCookies(context, EXPIRED());
    let target = AUTHORIZE_PATH;
    const path: string[] = [];
    let landed = false;
    for (let hop = 0; hop < 10 && !landed; hop++) {
      const url = new URL(target, ORIGIN);
      path.push(url.pathname);
      const isLogin = url.pathname === "/login";
      const args = isLogin ? loginGet(context, jar, new URL(target, ORIGIN).searchParams.get("returnTo") ?? "/inspections") : authorizeGet(context, jar, target);
      const out = await (isLogin ? loginLoader(args) : authorizeLoader(args)).then((v) => v, (e: unknown) => e);
      if (!(out instanceof Response)) {
        landed = isLogin;
        break;
      }
      jar = applySetCookies(jar, out.headers.getSetCookie());
      target = out.headers.get("Location") ?? "";
    }
    expect(landed, `path: ${path.join(" -> ")}`).toBe(true);
    expect(path.length).toBeLessThanOrEqual(3);
  });
});
