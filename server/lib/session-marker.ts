/**
 * An opaque, non-secret stand-in for "who is signed in", for the browser's service worker.
 *
 * The worker keeps per-user offline copies and must never hand one user's copy to the next user of the
 * same browser. It cannot read the HttpOnly session cookie, so it is told who is signed in with this
 * marker: a truncated SHA-256 of the user id. It is stored only in the visitor's own browser, it names
 * nobody, and it grants nothing; it is compared for equality and nothing more.
 *
 * Imports nothing, so workers/app.ts can use it without pulling the API graph in.
 */

const SESSION_COOKIE = '__Host-inspector_token';

export async function sessionMarker(userId: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`oi-session:${userId}`));
    return Array.from(new Uint8Array(digest).slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The marker for the user named by the session cookie, or null with no readable session.
 *
 * This reads the JWT payload WITHOUT verifying it, which is acceptable only because the result gates
 * nothing: it selects which offline copies the visitor's own browser may show that same browser. An
 * expired or forged cookie can only make the browser keep or drop its own cache.
 */
export async function sessionMarkerFromCookie(cookieHeader: string | null | undefined): Promise<string | null> {
    if (!cookieHeader) return null;
    for (const part of cookieHeader.split(/;\s*/)) {
        const eq = part.indexOf('=');
        if (eq <= 0 || part.slice(0, eq) !== SESSION_COOKIE) continue;
        try {
            const payload = decodeURIComponent(part.slice(eq + 1)).split('.')[1];
            if (!payload) return null;
            const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { sub?: unknown };
            return typeof claims.sub === 'string' && claims.sub ? await sessionMarker(claims.sub) : null;
        } catch {
            return null;
        }
    }
    return null;
}
