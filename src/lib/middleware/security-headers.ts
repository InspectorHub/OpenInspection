import { MiddlewareHandler } from 'hono';
import { HonoConfig } from '../../types/hono';

/**
 * Set defence-in-depth response headers on every route.
 *
 * - CSP: restricts script/style/frame sources to same-origin + allowlisted CDNs (Tailwind,
 *   ui-avatars). XSS via inline handlers is blocked without a nonce — set attributes in JS or
 *   use event listeners instead of inline onclick. HttpOnly on the auth cookie blocks *reading*
 *   the token from JS, but only a CSP blocks XSS-driven authenticated fetch() calls.
 * - X-Frame-Options DENY + frame-ancestors 'none': blocks clickjacking of dashboard pages.
 * - Referrer-Policy: prevents query-string secrets (reset tokens, one-time codes) from
 *   leaking to third parties via the Referer header.
 * - X-Content-Type-Options: stops content-type sniffing.
 * - Strict-Transport-Security: forces HTTPS for a year; CF Workers always serves over HTTPS.
 */
export const securityHeaders: MiddlewareHandler<HonoConfig> = async (c, next) => {
    await next();

    // NOTE: 'unsafe-inline' in script-src is a pragmatic compromise — existing templates use
    // inline onclick/onsubmit attributes. Refactor to event listeners (or add per-request
    // nonces) to drop this, at which point the CSP becomes a true XSS mitigation rather than
    // a defence-in-depth hint.
    c.header(
        'Content-Security-Policy',
        [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://unpkg.com https://challenges.cloudflare.com",
            "style-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://unpkg.com https://fonts.googleapis.com",
            "font-src 'self' https://fonts.gstatic.com",
            "img-src 'self' data: blob: https://ui-avatars.com",
            "connect-src 'self' https://challenges.cloudflare.com",
            "frame-src https://challenges.cloudflare.com",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "object-src 'none'",
        ].join('; ')
    );
    c.header('X-Frame-Options', 'DENY');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    c.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
};
