/**
 * CSRF helper for E2E specs.
 *
 * The API's `requireCsrfToken` middleware (server/lib/middleware/csrf.ts) is a
 * STATELESS double-submit check: it only asserts that the `__Host-csrf_token`
 * cookie equals the `x-csrf-token` header (timing-safe). The server never issues
 * the cookie — the real BFF mints its own matching pair (app/lib/csrf.ts
 * `makeCsrfPair()`) and attaches BOTH to the outbound API request.
 *
 * E2E specs are the "client" in that contract, so they mint the token the same
 * way. There is nothing to fetch: a fresh random token, sent as both cookie and
 * header, is a valid double-submit. (The old `GET /login` → read-Set-Cookie
 * approach always yielded '' because that cookie is never server-issued, so the
 * double-submit failed with 403.)
 *
 * This is mode-independent: the middleware is identical in standalone and saas.
 */

/** Mint a fresh CSRF token (128-bit hex), matching the middleware's own format. */
export function makeCsrfToken(): string {
    const buf = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(buf)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

/** CSRF headers ready to spread into a request: the header + the matching cookie. */
export function csrfHeaders(token = makeCsrfToken()): {
    token: string;
    headers: { 'X-CSRF-Token': string; Cookie: string };
} {
    return {
        token,
        headers: {
            'X-CSRF-Token': token,
            Cookie: `__Host-csrf_token=${token}`,
        },
    };
}
