/**
 * Generate a matching CSRF token + cookie pair for the BFF to attach to
 * non-GET API requests. The API verifies via `requireCsrfToken` middleware
 * (apps/core/server/lib/middleware/csrf.ts), which expects:
 *   - request header `x-csrf-token: <token>`
 *   - request cookie `__Host-csrf_token=<token>` (same value)
 */
export interface CsrfPair {
    headerValue: string;
    /** Already in `__Host-csrf_token=<value>` form, ready to append to Cookie header. */
    cookieValue: string;
}

export function makeCsrfPair(): CsrfPair {
    const token = crypto.randomUUID().replace(/-/g, '');
    return {
        headerValue: token,
        cookieValue: `__Host-csrf_token=${token}`,
    };
}
