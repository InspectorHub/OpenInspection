/**
 * The web app proves a person is present by solving a Turnstile challenge, then
 * leaves the one-time token in a short-lived cookie (`app/lib/human-token.ts`).
 * Route actions cannot set headers on a fetcher submit, and the in-process API
 * call an action makes would not otherwise see the browser's request, so the
 * worker entry copies the cookie onto the API call as `x-turnstile-token`. The
 * API verifies it lazily, only when a send inside a new company's cooling
 * window needs it (`diMiddleware`).
 */
const HUMAN_TOKEN_COOKIE = "oi-human-token";
export const HUMAN_TOKEN_HEADER = "x-turnstile-token";

/** Turnstile tokens are URL-safe; anything else is not ours and is dropped. */
const TOKEN_SHAPE = /^[A-Za-z0-9._-]{10,2048}$/;

export function humanTokenFromCookie(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0 || part.slice(0, eq).trim() !== HUMAN_TOKEN_COOKIE) continue;
    const value = part.slice(eq + 1).trim();
    return TOKEN_SHAPE.test(value) ? value : null;
  }
  return null;
}

/**
 * The API request, carrying the token when the browser left one. Reads and GETs
 * are returned untouched: only a mutation can send mail, and a token that rode
 * along on every render would be spent on nothing.
 */
export function withHumanToken(req: Request, outerCookieHeader: string | null | undefined): Request {
  if (req.method === "GET" || req.method === "HEAD" || req.headers.has(HUMAN_TOKEN_HEADER)) return req;
  const token = humanTokenFromCookie(outerCookieHeader);
  if (!token) return req;
  const headers = new Headers(req.headers);
  headers.set(HUMAN_TOKEN_HEADER, token);
  return new Request(req, { headers });
}
