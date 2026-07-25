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
import { requireToken } from "./session.server";

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
