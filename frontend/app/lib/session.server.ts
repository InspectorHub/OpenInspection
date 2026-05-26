import { createCookieSessionStorage, redirect } from "react-router";

const DEV_SECRET = "standalone-demo-session-secret-change-me";

function getSessionSecret(): string {
  const g = globalThis as Record<string, unknown>;
  if (typeof g.__SESSION_SECRET === "string" && g.__SESSION_SECRET) return g.__SESSION_SECRET;
  try {
    if (typeof process !== "undefined" && process?.env?.SESSION_SECRET) {
      return process.env.SESSION_SECRET;
    }
  } catch {}
  return DEV_SECRET;
}

let _storage: ReturnType<typeof createCookieSessionStorage> | null = null;

function getStorage() {
  const secret = getSessionSecret();
  if (!_storage || secret !== DEV_SECRET) {
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

export async function getSession(request: Request) {
  return getStorage().getSession(request.headers.get("Cookie"));
}

export async function getToken(request: Request): Promise<string | null> {
  const session = await getSession(request);
  return session.get("token") || null;
}

export async function requireToken(request: Request): Promise<string> {
  const token = await getToken(request);
  if (!token) throw redirect("/login");
  return token;
}

export async function createSessionWithToken(
  token: string,
  redirectTo: string,
) {
  const session = await getStorage().getSession();
  session.set("token", token);
  return redirect(redirectTo, {
    headers: {
      "Set-Cookie": await getStorage().commitSession(session),
    },
  });
}

export async function destroyUserSession(request: Request) {
  const session = await getSession(request);
  return redirect("/login", {
    headers: {
      "Set-Cookie": await getStorage().destroySession(session),
    },
  });
}
