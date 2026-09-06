import { createCookieSessionStorage, redirect } from "react-router";
import type { SessionStorage } from "react-router";
import { getCloudflareEnv, type LoadContext } from "~/lib/load-context";
import { deriveSessionSecret } from "~/lib/session-secret";

/** Fields stored in the React Router `__session` cookie. */
type AppSessionData = { token: string };

/**
 * Cached derivation — PBKDF2 at 100k iterations is too costly per request.
 *
 * ⚠️ The memo is PER-ISOLATE, so this is not "paid once": every new isolate
 * pays it on its FIRST request, and `getToken` sits on nearly every route
 * (including `routes/home.tsx`, which only redirects). Measured 2026-09-06:
 * the derivation alone exceeds the Workers Free plan's entire 10ms CPU budget.
 * Provision `SESSION_SECRET` and this never runs — `scripts/derive-session-secret.ts`
 * computes the byte-identical value so existing cookies keep verifying.
 */
let _derived: { from: string; value: Promise<string> } | null = null;

function readEnvVar(context: LoadContext | undefined, name: "SESSION_SECRET" | "JWT_SECRET"): string | undefined {
  const fromBinding = getCloudflareEnv(context as LoadContext)[name];
  if (fromBinding) return fromBinding;
  // Node-only path: the vitest suites run these helpers outside workerd, where
  // there is no binding to read from.
  try {
    if (typeof process !== "undefined" && process?.env?.[name]) return process.env[name];
  } catch { /* env not available in this runtime */ }
  return undefined;
}

/**
 * Signing secret for the `__session` cookie.
 *
 * `SESSION_SECRET` when provisioned; otherwise DERIVED from `JWT_SECRET`. There
 * is deliberately no constant default: a fallback literal means every
 * deployment that never set the variable signs its cookies with a value
 * published in this repository, which is the same as not signing them.
 *
 * Derivation rather than reuse keeps the two credentials separate — JWT_SECRET
 * is also the KDF input for config-crypto and the audit signing keys, so
 * disclosing the cookie secret must not hand over those as well.
 *
 * Both unset is a configuration error, not a degraded mode, so this throws.
 * JWT_SECRET is required for the app to function at all, so that can only
 * happen on a genuinely unconfigured deployment.
 */
async function getSessionSecret(context?: LoadContext): Promise<string> {
  const explicit = readEnvVar(context, "SESSION_SECRET");
  if (explicit) return explicit;

  const jwtSecret = readEnvVar(context, "JWT_SECRET");
  if (!jwtSecret) {
    throw new Error(
      "Cannot sign session cookies: neither SESSION_SECRET nor JWT_SECRET is configured.",
    );
  }
  if (_derived?.from !== jwtSecret) {
    _derived = { from: jwtSecret, value: deriveSessionSecret(jwtSecret) };
  }
  return _derived.value;
}

let _storage: SessionStorage<AppSessionData> | null = null;
let _storageSecret: string | null = null;

async function getStorage(context?: LoadContext) {
  const secret = await getSessionSecret(context);
  if (!_storage || secret !== _storageSecret) {
    _storageSecret = secret;
    _storage = createCookieSessionStorage<AppSessionData>({
      cookie: {
        name: "__session",
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 7,
        secrets: [secret],
      },
    });
  }
  return _storage;
}

/**
 * Read path. An unverifiable `__session` is treated as ABSENT, not as a failure:
 * when no signing secret is configured we cannot vouch for the cookie, and the
 * fail-closed response to "this credential can't be verified" is to ignore it —
 * not to fault the request. Callers fall through to the raw JWT cookie, which
 * carries its own ES256 signature and needs no secret to be read.
 *
 * The WRITE path deliberately does not do this: `createSessionWithToken` lets
 * the error propagate rather than issue an unprotected cookie.
 */
async function getSession(context: LoadContext, request: Request) {
  try {
    return await (await getStorage(context)).getSession(request.headers.get("Cookie"));
  } catch {
    return null;
  }
}

/** Read a single raw cookie value from the request's Cookie header. */
function readRawCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq) === name) {
      return decodeURIComponent(part.slice(eq + 1));
    }
  }
  return null;
}

export async function getToken(context: LoadContext, request: Request): Promise<string | null> {
  const session = await getSession(context, request);
  const fromSession = session?.get("token");
  if (fromSession) return fromSession;
  // Fallback: the SSO handoff consume (GET /sso, server/api/auth.ts) sets the
  // JWT only in the raw `__Host-inspector_token` cookie and never writes the
  // React Router `__session` cookie that createUserSession sets on local form
  // login. Without this fallback, loaders' requireToken() bounce every SSO
  // arrival to /login even though the session is valid. Both cookies carry the
  // same JWT; the value is used purely as the bearer token for createApi().
  return readRawCookie(request, "__Host-inspector_token");
}

/**
 * Whether a session token is past its `exp`, read from the JWT payload.
 *
 * This is NOT verification — the API verifies the signature through the ES256
 * keyring, and nothing here may be trusted for authorization. It answers one
 * cheaper question: is it even worth sending? A token whose payload cannot be
 * read counts as expired, so an unreadable value can never be passed on.
 */
function isTokenExpired(token: string, nowMs: number): boolean {
  const payload = token.split(".")[1];
  if (!payload) return true;
  try {
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    if (typeof exp !== "number") return true;
    return exp * 1000 <= nowMs;
  } catch {
    return true;
  }
}

/**
 * Which sign-in page a session ends on.
 *
 * There are two front doors and they are not interchangeable. `/login` is for
 * STAFF: an agent has no account there, and under `APP_MODE=saas`
 * `routes/login.tsx` 302s again to the portal's own login — out of this
 * product entirely, onto a portal sign-in an agent cannot use. So an agent sent
 * to `/login` on logout or on expiry does not land on a login page; they land
 * on a dead end. Agents sign in at `/agent-login`.
 *
 * Derived from the path rather than passed in by each caller, because the
 * callers are `requireToken` and `destroyUserSession` — one is invoked by every
 * agent loader and the other by the logout route, and an agent surface added
 * later would otherwise have to remember to ask. Every agent page is mounted
 * under the `agent-` prefix (`app/routes.ts`), including `agent-logout`, which
 * exists so that the teardown route carries the same signal as the pages.
 *
 * The prefix is the whole rule: `/contacts` and `/inspections/agent-notes` are
 * staff pages ABOUT agents and stay on the staff door.
 */
function loginPathFor(request: Request): "/login" | "/agent-login" {
  return new URL(request.url).pathname.startsWith("/agent-") ? "/agent-login" : "/login";
}

export async function requireToken(context: LoadContext, request: Request): Promise<string> {
  const token = await getToken(context, request);
  if (!token) throw redirect(loginPathFor(request));
  // An expired session is the ordinary end of a session, not a failure. Without
  // this, the cookie still EXISTS so the loader proceeded, every API call
  // answered 401, and the page fell into its error boundary — the visitor saw
  // "something went wrong" when all that happened is that they need to log in
  // again. Clear the dead cookies on the way out so the next request is clean.
  if (isTokenExpired(token, Date.now())) throw await destroyUserSession(context, request);
  return token;
}

/**
 * The raw JWT cookie the API authenticates by, built here so the app tier can
 * plant it too.
 *
 * Why the app has to: a browser-direct hit on the API (portal SSO, `GET /sso`)
 * receives this cookie straight from Hono, but a form login goes through the
 * BFF, and Workers' fetch() strips Set-Cookie on that server-to-server hop —
 * see the "Token Relay BFF" comment in server/api/auth.ts, which is why it also
 * returns the JWT in its body. Without this, the browser holds only the React
 * Router session cookie: loaders work (they relay the token as a Bearer) while
 * anything the BROWSER issues directly does not, which is what left the collab
 * WebSocket answering 401 and the editor's edits stranded in IndexedDB.
 *
 * Attributes mirror the API's own `authCookieOptions()` exactly — one credential
 * with one set of rules, whichever tier writes it. Max-Age tracks the JWT's own
 * 24h life so the cookie cannot outlive the token inside it.
 *
 * Note `Secure`: the `__Host-` prefix requires it, so a plain-http origin (local
 * `wrangler dev`) will refuse this cookie. Browser-direct API calls therefore
 * still need https locally — a tunnel, or a TLS terminator.
 */
export function browserJwtCookie(token: string): string {
  const maxAge = 60 * 60 * 24;
  return `__Host-inspector_token=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

export async function createSessionWithToken(
  context: LoadContext,
  token: string,
  redirectTo: string,
) {
  const storage = await getStorage(context);
  const session = await storage.getSession();
  session.set("token", token);
  const headers = new Headers();
  headers.append("Set-Cookie", await storage.commitSession(session));
  headers.append("Set-Cookie", browserJwtCookie(token));
  return redirect(redirectTo, { headers });
}

export async function destroyUserSession(context: LoadContext, request: Request) {
  const session = await getSession(context, request);
  const headers = new Headers();
  // Logging out must work even when no signing secret is configured — the point
  // of this call is to REMOVE credentials, so being unable to verify the one
  // being removed is no reason to leave the visitor logged in. The raw JWT
  // cookie below is expired unconditionally.
  if (session) {
    try {
      headers.append("Set-Cookie", await (await getStorage(context)).destroySession(session));
    } catch { /* no secret to sign the expiry with; the raw cookie still clears */ }
  }
  // Also expire the raw JWT cookie the API sets (and that getToken() falls back
  // to). Without this, logout would clear only the RR `__session` cookie and the
  // getToken fallback would keep the user authenticated via __Host-inspector_token.
  // __Host- prefix requires Secure + Path=/ + no Domain.
  headers.append(
    "Set-Cookie",
    "__Host-inspector_token=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0",
  );
  return redirect(loginPathFor(request), { headers });
}
