/**
 * Cookie attributes for the auth token. `__Host-` prefix demands Secure + path=/ + no Domain,
 * which this helper already satisfies. SameSite=Strict blocks all cross-site cookie sending —
 * including top-level navigation — so a malicious link can never drag a logged-in session
 * into a mutation or a sensitive GET.
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
