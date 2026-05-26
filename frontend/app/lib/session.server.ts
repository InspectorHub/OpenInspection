import { createCookieSessionStorage, redirect } from "react-router";

const SESSION_SECRET = "standalone-demo-session-secret-change-me";

const sessionStorage = createCookieSessionStorage({
  cookie: {
    name: "__session",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
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
