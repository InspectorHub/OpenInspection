import type { MiddlewareHandler } from 'hono';
import type { HonoConfig } from '../../types/hono';
import { buildCsp, isWidgetEmbedPath } from '../csp-policy';

/**
 * Set defence-in-depth response headers on every route.
 *
 * - CSP: restricts script/style/frame sources to same-origin + Cloudflare Turnstile.
 *   XSS via inline handlers is blocked without a nonce — set attributes in JS or
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

    // B2: /book?embed=1 (legacy) and Sprint C-4 /embed/book/<slug> are the
    // embeddable booking widgets — must allow framing by any origin. Origin-
    // allowlist enforcement on the actual booking submit (POST /api/public/book)
    // is the security boundary, not frame-ancestors.
    const isWidgetEmbed = isWidgetEmbedPath(c.req.path, c.req.query('embed'));

    // The allowlist lives in lib/csp-policy.ts, shared with the page headers.
    c.header('Content-Security-Policy', buildCsp({ widgetEmbed: isWidgetEmbed }));
    if (!isWidgetEmbed) {
        c.header('X-Frame-Options', 'DENY');
    }
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    c.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
};
