import type { Context } from 'hono';

/**
 * The session cookie's name. `__Host-` is not decoration: the prefix makes the
 * browser REFUSE the cookie unless it is Secure, path=/ and carries no Domain,
 * so the constraints below are enforced by the client too.
 */
export const AUTH_COOKIE_NAME = '__Host-inspector_token';

/**
 * The Bearer token from the Authorization header, or undefined.
 *
 * Four sites parsed this by hand — `jwt-auth` plus three resolvers in
 * `public-access` — each with the same `startsWith('Bearer ') ? slice(7)`. The
 * magic number is the point: `7` is `'Bearer '.length`, and it is the kind of
 * thing that survives a copy but not a change.
 *
 * Callers that also accept a cookie compose it themselves
 * (`bearerToken(c) ?? getCookie(c, AUTH_COOKIE_NAME)`) rather than having a
 * fallback baked in here — only the JWT middleware wants that, and hiding it
 * would make the public resolvers look like they accept cookies when they must
 * not.
 */
const BEARER_PREFIX = 'Bearer ';

export function bearerToken(c: Context): string | undefined {
    const header = c.req.header('Authorization');
    return header?.startsWith(BEARER_PREFIX) ? header.slice(BEARER_PREFIX.length) : undefined;
}

/**
 * Cookie attributes for the auth token. `__Host-` prefix demands Secure + path=/ + no Domain,
 * which this helper already satisfies. SameSite=Strict blocks all cross-site cookie sending —
 * including top-level navigation — so a malicious link can never drag a logged-in session
 * into a mutation or a sensitive GET.
 *
 * Five further sites (agent login, agent magic-login, agent signup, agent
 * accept, portal handoff) wrote these five attributes out by hand. They were
 * byte-identical, so nothing was broken — but CLAUDE.md mandates all four
 * security attributes on every setCookie, and five hand-maintained copies is
 * four chances to miss the next policy change.
 */
export function authCookieOptions() {
    return {
        httpOnly: true,
        secure: true,
        sameSite: 'Strict' as const,
        path: '/',
        maxAge: 60 * 60 * 24,
    };
}

/** The client-portal session cookie's name (`__Host-` for the same reasons). */
export const PORTAL_SESSION_COOKIE_NAME = '__Host-portal_session';

/**
 * Cookie attributes for the CLIENT PORTAL session.
 *
 * Deliberately `SameSite=Lax`, not Strict like the staff session above: a client
 * arrives by following a link out of their email, and Strict would withhold the
 * cookie on that top-level navigation — they would land logged out on the page
 * the link promised. Lax still blocks cross-site sub-requests and non-GET
 * navigation, which is the part that matters.
 *
 * It lives here rather than beside its two call sites so that EVERY cookie
 * policy in the app is readable in one file, and so the lint rule can require a
 * factory instead of an inline object without leaving one legitimate exception.
 */
export function portalSessionCookieOptions() {
    return {
        httpOnly: true,
        secure: true,
        sameSite: 'Lax' as const,
        path: '/',
    };
}
