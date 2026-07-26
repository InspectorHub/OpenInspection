// @vitest-environment node
//
// Server-only module: nothing here touches the DOM, and the default happy-dom
// environment strips `Set-Cookie` from Response headers, which the secret specs
// below need to read back.
/**
 * A session that has EXPIRED must land the visitor on the login page, not on an
 * error page.
 *
 * requireToken used to check only that a token cookie existed. An expired JWT is
 * still a cookie, so every loader proceeded, every API call answered 401, and
 * the page fell into its error boundary — "Something went wrong" for the most
 * ordinary thing a session does, which is end.
 */
import { describe, it, expect } from "vitest";
import type { AppLoadContext } from "react-router";
import {
  requireToken,
  browserJwtCookie,
  createSessionWithToken,
  getToken,
} from "./session.server";

const CONTEXT = {} as AppLoadContext;

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** A structurally valid JWT. The signature is never checked here — the API
 *  verifies it; this layer only decides whether to bother asking. */
function jwt(payload: Record<string, unknown>): string {
  return `${b64url({ alg: "ES256", typ: "JWT", kid: "v1" })}.${b64url(payload)}.sig`;
}

/**
 * `new Request(url, { headers: { Cookie } })` silently DROPS the cookie —
 * Cookie is a forbidden header name in fetch — so the header is built directly.
 * requireToken only ever reads `request.headers.get("Cookie")`.
 */
function requestWithCookie(cookie: string | null): Request {
  return {
    headers: new Headers(cookie ? { Cookie: cookie } : {}),
  } as unknown as Request;
}

function requestWithToken(token: string): Request {
  return requestWithCookie(`__Host-inspector_token=${token}`);
}

const HOUR = 3600;
const nowSec = () => Math.floor(Date.now() / 1000);

async function captureThrown(fn: () => Promise<unknown>): Promise<Response> {
  try {
    await fn();
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    throw thrown;
  }
  throw new Error("expected a redirect Response to be thrown");
}

describe("requireToken", () => {
  it("sends a visitor with no session to the login page", async () => {
    const res = await captureThrown(() =>
      requireToken(CONTEXT, requestWithCookie(null)),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/login");
  });

  it("returns a live token untouched", async () => {
    const token = jwt({ sub: "u1", exp: nowSec() + HOUR });
    await expect(requireToken(CONTEXT, requestWithToken(token))).resolves.toBe(token);
  });

  it("sends an EXPIRED session to the login page instead of into a broken page", async () => {
    const res = await captureThrown(() =>
      requireToken(CONTEXT, requestWithToken(jwt({ sub: "u1", exp: nowSec() - HOUR }))),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/login");
  });

  // NOT asserted here: that the dead cookies are cleared. requireToken routes
  // the expired case through destroyUserSession (the same teardown /logout
  // uses), but this environment strips Set-Cookie from a scripted Response —
  // it is a forbidden response header — so the headers read back empty no
  // matter what the code does. Asserting it here would only test the stub.
  // The clearing itself is covered where it is observable: the /logout route.

  it("treats an unreadable token as no session — fail closed, never pass it on", async () => {
    for (const bad of ["not-a-jwt", "a.b", "a.!!!.c", jwt({ sub: "u1" })]) {
      const res = await captureThrown(() => requireToken(CONTEXT, requestWithToken(bad)));
      expect(res.headers.get("Location")).toBe("/login");
    }
  });
});

/**
 * Two login paths, one credential — only one of them used to plant it.
 *
 * A browser-direct hit on the API (portal SSO, `GET /sso`) gets
 * `Set-Cookie: __Host-inspector_token` straight from Hono. A form login goes
 * through the BFF instead, and Workers' fetch() strips Set-Cookie on that
 * server-to-server hop (see the comment at server/api/auth.ts:317) — so the
 * browser ended up holding only the React-Router session cookie. Loaders kept
 * working, because they relay the token as a Bearer; anything the BROWSER
 * issues directly did not: the collab WebSocket 401'd on every handshake, and
 * the editor's edits never left IndexedDB.
 *
 * So the app tier plants the same cookie the SSO path plants. Asserted on the
 * header string, not a Response: this environment strips Set-Cookie from a
 * scripted Response, so a Response-level assertion would test the stub.
 */
describe("browserJwtCookie", () => {
  const TOKEN = "header.payload.signature";

  it("carries the JWT under the name the API authenticates", () => {
    expect(browserJwtCookie(TOKEN)).toContain(`__Host-inspector_token=${TOKEN}`);
  });

  it("matches the attributes the API's own cookie uses", () => {
    const cookie = browserJwtCookie(TOKEN);
    // __Host- requires Secure + Path=/ + no Domain; Strict keeps it off
    // cross-site requests; HttpOnly keeps it out of document.cookie.
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain("Domain=");
  });

  it("expires with the JWT rather than outliving it", () => {
    // The token itself is a 24h JWT; a longer-lived cookie would just carry a
    // dead credential the API rejects.
    expect(browserJwtCookie(TOKEN)).toContain(`Max-Age=${60 * 60 * 24}`);
  });
});

/**
 * The `__session` signing secret used to fall back to a constant literal. Since
 * SESSION_SECRET was in fact never provisioned in any config, `.dev.vars`, or
 * setup script, that fallback was not a dev convenience — it was the value every
 * deployment actually signed with, published in this repository.
 *
 * The replacement derives from JWT_SECRET (required anyway) rather than
 * introducing a new mandatory variable, which would have broken the one-click
 * deploy path. These specs pin all three behaviors.
 */
describe("session cookie secret", () => {
  const TOKEN = jwt({ exp: Math.floor(Date.now() / 1000) + 3600 });

  function contextWith(env: Record<string, string>): AppLoadContext {
    return { cloudflare: { env, ctx: {} } } as unknown as AppLoadContext;
  }

  /**
   * The signed `__session` value, which encodes the secret it was signed with.
   * Read via `get()` rather than `getSetCookie()` — the latter is not
   * implemented in this test environment's Headers.
   */
  async function sessionCookieFor(context: AppLoadContext): Promise<string> {
    const response = await createSessionWithToken(context, TOKEN, "/");
    const raw = response.headers.get("Set-Cookie") ?? "";
    const match = /__session=([^;,]+)/.exec(raw);
    if (!match) throw new Error(`no __session cookie was set (got: ${raw})`);
    return match[1];
  }

  it("refuses to sign when neither SESSION_SECRET nor JWT_SECRET is available", async () => {
    // Fail closed on the WRITE path: issuing a cookie nobody can verify is
    // worse than refusing to issue one.
    await expect(sessionCookieFor(contextWith({}))).rejects.toThrow(
      /neither SESSION_SECRET nor JWT_SECRET/,
    );
  });

  it("derives a secret from JWT_SECRET when SESSION_SECRET is unset", async () => {
    // Succeeding at all is the assertion — without a derivation path this
    // would throw per the spec above. Keeps one-click deploys working without
    // a hardcoded default.
    expect(await sessionCookieFor(contextWith({ JWT_SECRET: "jwt-secret-value" }))).not.toEqual(
      "",
    );
  });

  it("prefers an explicit SESSION_SECRET over deriving one", async () => {
    const derived = await sessionCookieFor(contextWith({ JWT_SECRET: "shared" }));
    const explicit = await sessionCookieFor(
      contextWith({ JWT_SECRET: "shared", SESSION_SECRET: "explicit" }),
    );
    expect(explicit).not.toEqual(derived);
  });

  it("never uses JWT_SECRET verbatim as the cookie secret", async () => {
    // Domain separation: JWT_SECRET is also the KDF input for config-crypto and
    // the audit signing keys, so disclosing the cookie secret must not disclose
    // those. Signing with the raw value would collapse that separation.
    const derived = await sessionCookieFor(contextWith({ JWT_SECRET: "shared" }));
    const verbatim = await sessionCookieFor(contextWith({ SESSION_SECRET: "shared" }));
    expect(derived).not.toEqual(verbatim);
  });

  it("reads an unverifiable session as absent instead of faulting the request", async () => {
    // The READ path must not fail closed by crashing: SSO arrivals carry only
    // the raw JWT cookie and never touch __session, so an unconfigured secret
    // must not take them down.
    await expect(getToken(contextWith({}), requestWithToken(TOKEN))).resolves.toEqual(TOKEN);
  });
});
