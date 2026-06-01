import { createCookieSessionStorage, redirect } from "react-router";
import type { AppLoadContext } from "react-router";

const DEV_SECRET = "standalone-demo-session-secret-change-me";

function getSessionSecret(context?: AppLoadContext): string {
  if (context?.cloudflare?.env?.SESSION_SECRET) return context.cloudflare.env.SESSION_SECRET as string;
  try {
    if (typeof process !== "undefined" && process?.env?.SESSION_SECRET) {
      return process.env.SESSION_SECRET;
    }
  } catch {}
  return DEV_SECRET;
}

let _storage: ReturnType<typeof createCookieSessionStorage> | null = null;
let _storageSecret: string | null = null;

function getStorage(context?: AppLoadContext) {
  const secret = getSessionSecret(context);
  if (!_storage || secret !== _storageSecret) {
    _storageSecret = secret;
    _storage = createCookieSessionStorage({
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

export async function getSession(context: AppLoadContext, request: Request) {
  return getStorage(context).getSession(request.headers.get("Cookie"));
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

export async function getToken(context: AppLoadContext, request: Request): Promise<string | null> {
  const session = await getSession(context, request);
  const fromSession = session.get("token");
  if (fromSession) return fromSession;
  // Fallback: the SSO handoff consume (GET /sso, server/api/auth.ts) sets the
  // JWT only in the raw `__Host-inspector_token` cookie and never writes the
  // React Router `__session` cookie that createUserSession sets on local form
  // login. Without this fallback, loaders' requireToken() bounce every SSO
  // arrival to /login even though the session is valid. Both cookies carry the
  // same JWT; the value is used purely as the bearer token for createApi().
  return readRawCookie(request, "__Host-inspector_token");
}

export async function requireToken(context: AppLoadContext, request: Request): Promise<string> {
  const token = await getToken(context, request);
  if (!token) throw redirect("/login");
  return token;
}

export async function createSessionWithToken(
  context: AppLoadContext,
  token: string,
  redirectTo: string,
) {
  const session = await getStorage(context).getSession();
  session.set("token", token);
  return redirect(redirectTo, {
    headers: {
      "Set-Cookie": await getStorage(context).commitSession(session),
    },
  });
}

export async function destroyUserSession(context: AppLoadContext, request: Request) {
  const session = await getSession(context, request);
  const headers = new Headers();
  headers.append("Set-Cookie", await getStorage(context).destroySession(session));
  // Also expire the raw JWT cookie the API sets (and that getToken() falls back
  // to). Without this, logout would clear only the RR `__session` cookie and the
  // getToken fallback would keep the user authenticated via __Host-inspector_token.
  // __Host- prefix requires Secure + Path=/ + no Domain.
  headers.append(
    "Set-Cookie",
    "__Host-inspector_token=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0",
  );
  return redirect("/login", { headers });
}
