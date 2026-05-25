import { createCookieSessionStorage, redirect } from "react-router";

// On Cloudflare Workers, process.env is available at build time via Vite but
// not at request time.  For cookie-based sessions the secret only needs to
// be a stable string — it never leaves the worker.  We fall back to a dev
// secret so local `npm run dev` works out of the box.
const SESSION_SECRET =
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  (typeof process !== "undefined" && process.env?.SESSION_SECRET) ||
  "dev-secret-change-in-production";

const sessionStorage = createCookieSessionStorage({
  cookie: {
    name: "__session",
    httpOnly: true,
    secure: false, // false for local dev; production proxy terminates TLS
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 1 week
    secrets: [SESSION_SECRET],
  },
});

export async function getSession(request: Request) {
  return sessionStorage.getSession(request.headers.get("Cookie"));
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
  const session = await sessionStorage.getSession();
  session.set("token", token);
  return redirect(redirectTo, {
    headers: {
      "Set-Cookie": await sessionStorage.commitSession(session),
    },
  });
}

export async function destroyUserSession(request: Request) {
  const session = await getSession(request);
  return redirect("/login", {
    headers: {
      "Set-Cookie": await sessionStorage.destroySession(session),
    },
  });
}
