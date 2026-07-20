import { MiddlewareHandler } from 'hono';
import { HonoConfig } from '../../types/hono';

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
    const isWidgetEmbed =
        (c.req.path === '/book' && c.req.query('embed') === '1') ||
        c.req.path.startsWith('/embed/');

    c.header(
        'Content-Security-Policy',
        [
            "default-src 'self'",
            // maps.googleapis.com: the Google Maps JavaScript SDK (address
            // autocomplete map, Spec 5D B4) — a deliberate CDN exception to the
            // "no CDN except GA + Turnstile" rule; the SDK cannot be self-hosted.
            "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://maps.googleapis.com",
            "style-src 'self' 'unsafe-inline'",
            "font-src 'self' data:",
            // maps.gstatic.com / maps.googleapis.com: map tiles + marker sprites.
            "img-src 'self' data: blob: https://maps.gstatic.com https://maps.googleapis.com",
            // maps.googleapis.com: the Maps SDK's own XHR/fetch for tile metadata.
            "connect-src 'self' https://challenges.cloudflare.com https://maps.googleapis.com",
            // 'self' required so the Settings → Embed Widget page can iframe
            // its own /book?embed=1 preview. Without it the live preview is blank.
            "frame-src 'self' https://challenges.cloudflare.com",
            isWidgetEmbed ? "frame-ancestors *" : "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "object-src 'none'",
        ].join('; ')
    );
    if (!isWidgetEmbed) {
        c.header('X-Frame-Options', 'DENY');
    }
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    c.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
};
