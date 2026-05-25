import { MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { HonoConfig } from '../../types/hono';
import { Errors } from '../errors';
import { timingSafeEqual } from '../password';

const CSRF_COOKIE = '__Host-csrf_token';
const CSRF_HEADER = 'x-csrf-token';
const CSRF_TTL_SECONDS = 60 * 60 * 24;

/** Random 128-bit token, hex-encoded. */
function generateCsrfToken(): string {
    const buf = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Issue (or refresh) the CSRF token cookie. Call this on any HTML page that renders a form
 * posting to a state-changing endpoint — the page's JS will read the cookie and echo it as
 * a header on the submit.
 *
 * The cookie is **not** HttpOnly so same-origin JS can read it, but `__Host-` + Secure +
 * SameSite=Strict still prevents a cross-site attacker from reading or forging it.
 */
export function issueCsrfCookie(c: Parameters<MiddlewareHandler<HonoConfig>>[0]) {
    const existing = getCookie(c, CSRF_COOKIE);
    if (existing) return existing;
    const token = generateCsrfToken();
    setCookie(c, CSRF_COOKIE, token, {
        httpOnly: false,
        secure: true,
        sameSite: 'Strict',
        path: '/',
        maxAge: CSRF_TTL_SECONDS,
    });
    return token;
}

/**
 * Double-submit CSRF check. Apply to state-changing endpoints that can be called from a
 * browser *without* a prior session — notably the login endpoint, which is otherwise a
 * pathway for login-CSRF / session fixation.
 */
export const requireCsrfToken: MiddlewareHandler<HonoConfig> = async (c, next) => {
    const cookieToken = getCookie(c, CSRF_COOKIE);
    const headerToken = c.req.header(CSRF_HEADER);
    if (!cookieToken || !headerToken || !timingSafeEqual(cookieToken, headerToken)) {
        throw Errors.Forbidden('CSRF token missing or invalid');
    }
    return next();
};
