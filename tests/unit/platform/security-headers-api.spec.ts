/**
 * The API middleware's output, pinned byte for byte. The policy builder moved to
 * lib/csp-policy.ts (shared with the page headers); this proves the move changed
 * nothing on API responses.
 */
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { securityHeaders } from '../../../server/lib/middleware/security-headers';
import { buildCsp } from '../../../server/lib/csp-policy';

// Verbatim from the middleware before the policy builder was extracted.
const NORMAL_CSP =
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://maps.googleapis.com; " +
    "style-src 'self' 'unsafe-inline'; " +
    "font-src 'self' data:; " +
    "img-src 'self' data: blob: https://maps.gstatic.com https://maps.googleapis.com; " +
    "connect-src 'self' https://challenges.cloudflare.com https://maps.googleapis.com; " +
    "frame-src 'self' https://challenges.cloudflare.com; " +
    "frame-ancestors 'none'; " +
    "base-uri 'self'; " +
    "form-action 'self'; " +
    "object-src 'none'";
const EMBED_CSP = NORMAL_CSP.replace("frame-ancestors 'none'", 'frame-ancestors *');

const app = new Hono().use('*', securityHeaders as never).get('*', (c) => c.text('ok'));

describe('API securityHeaders middleware (byte-identical)', () => {
    it('a normal path', async () => {
        const res = await app.request('/api/anything');
        expect(res.headers.get('Content-Security-Policy')).toBe(NORMAL_CSP);
        expect(res.headers.get('X-Frame-Options')).toBe('DENY');
        expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
        expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
        expect(res.headers.get('Strict-Transport-Security')).toBe('max-age=31536000; includeSubDomains');
        expect(res.headers.get('Permissions-Policy')).toBe('geolocation=(), microphone=(), camera=()');
    });

    it.each(['/book?embed=1', '/embed/acme'])('the embed path %s', async (path) => {
        const res = await app.request(path);
        expect(res.headers.get('Content-Security-Policy')).toBe(EMBED_CSP);
        expect(res.headers.get('X-Frame-Options')).toBeNull();
        expect(res.headers.get('Permissions-Policy')).toBe('geolocation=(), microphone=(), camera=()');
    });

    it('/book without embed=1 is not an embed', async () => {
        const res = await app.request('/book');
        expect(res.headers.get('Content-Security-Policy')).toBe(NORMAL_CSP);
        expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    });

    it('the shared builder with default options is the enforced policy, and the strict variant only drops inline', () => {
        expect(buildCsp({ widgetEmbed: false })).toBe(NORMAL_CSP);
        expect(buildCsp({ widgetEmbed: false, allowInline: false })).toBe(NORMAL_CSP.replaceAll(" 'unsafe-inline'", ''));
    });
});
