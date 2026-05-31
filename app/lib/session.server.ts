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

export async function getToken(context: AppLoadContext, request: Request): Promise<string | null> {
  const session = await getSession(context, request);
  return session.get("token") || null;
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
  return redirect("/login", {
    headers: {
      "Set-Cookie": await getStorage(context).destroySession(session),
    },
  });
}
