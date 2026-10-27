/**
 * Security headers on rendered HTML pages. Pages never pass through the API app's
 * securityHeaders middleware, so `workers/app.ts` stamps their own set.
 */
import { describe, expect, it } from 'vitest';
import { pageSecurityHeaders, PAGE_PERMISSIONS_POLICY, STRICT_POLICY_EVERY_NTH_PAGE } from '../../../server/lib/page-security-headers';
import { securityHeadersForPage } from '../../../server/lib/page-response-headers';
import { finishPage } from '../../../server/lib/page-timing';
import { readFileSync } from 'node:fs';
import { buildCsp } from '../../../server/lib/csp-policy';

const headersFor = (path: string, query = '', strict = true) => pageSecurityHeaders(path, new URLSearchParams(query), strict);
const policies = (h: Record<string, string>) => h['Content-Security-Policy-Report-Only']!.split(', ');
const directive = (policy: string, name: string) => policy.split('; ').find((d) => d.startsWith(`${name} `));

describe('pageSecurityHeaders', () => {
    it('a normal page is frameable only by its own origin and carries the referrer and feature policies', () => {
        const h = headersFor('/login');
        expect(h['X-Frame-Options']).toBe('SAMEORIGIN');
        expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
        expect(h['Permissions-Policy']).toBe(PAGE_PERMISSIONS_POLICY);
        for (const p of policies(h)) expect(directive(p, 'frame-ancestors')).toBe("frame-ancestors 'self'");
    });

    it.each([
        ['/book', 'embed=1'],
        ['/embed/some-slug', ''],
    ])('the widget embed page %s?%s stays frameable by any origin', (path, query) => {
        const h = headersFor(path, query);
        expect(h['X-Frame-Options']).toBeUndefined();
        for (const p of policies(h)) expect(directive(p, 'frame-ancestors')).toBe('frame-ancestors *');
        expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    });

    it('/book without embed=1 is a normal page (control for the embed exemption)', () => {
        expect(headersFor('/book')['X-Frame-Options']).toBe('SAMEORIGIN');
        expect(headersFor('/book', 'embed=0')['X-Frame-Options']).toBe('SAMEORIGIN');
    });

    it('allows the camera for this origin only and keeps microphone and geolocation off', () => {
        expect(PAGE_PERMISSIONS_POLICY).toBe('geolocation=(), microphone=(), camera=(self)');
    });

    it('sends two report-only policies, both reporting to the same-origin receiver, and enforces none', () => {
        const h = headersFor('/login');
        expect(h['Content-Security-Policy']).toBeUndefined();
        const [allowlist, strict] = policies(h);
        expect(policies(h)).toHaveLength(2);
        expect(allowlist!.endsWith('; report-uri /api/public/csp-report?p=a')).toBe(true);
        expect(strict!.endsWith('; report-uri /api/public/csp-report?p=b')).toBe(true);
        expect(directive(allowlist!, 'script-src')).toContain("'unsafe-inline'");
        expect(directive(allowlist!, 'style-src')).toContain("'unsafe-inline'");
        expect(directive(strict!, 'script-src')).toBe(
            'script-src \'self\' https://challenges.cloudflare.com https://maps.googleapis.com https://js.stripe.com',
        );
        expect(directive(strict!, 'style-src')).toBe("style-src 'self'");
        expect(strict).not.toContain('unsafe-inline');
    });
});

describe('pages and the API intentionally differ on framing', () => {
    it('pages are SAMEORIGIN / frame-ancestors self; the API stays DENY / frame-ancestors none', () => {
        const page = headersFor('/login');
        expect(page['X-Frame-Options']).toBe('SAMEORIGIN');
        for (const p of policies(page)) expect(p).toContain("frame-ancestors 'self'");
        expect(buildCsp({ widgetEmbed: false })).toContain("frame-ancestors 'none'");
        expect(buildCsp({ widgetEmbed: false, sameOriginFraming: true })).toContain("frame-ancestors 'self'");
        // the embed routes are unchanged whatever the option says
        expect(buildCsp({ widgetEmbed: true, sameOriginFraming: true })).toContain('frame-ancestors *');
    });
});

describe('hosts only pages load', () => {
    const [allowlist, strict] = policies(headersFor('/login'));

    it.each([
        ['script-src', 'https://js.stripe.com'],
        ['frame-src', 'https://js.stripe.com'],
        ['frame-src', 'https://hooks.stripe.com'],
        ['frame-src', 'https://*.cloudflarestream.com'],
        ['connect-src', 'https://api.stripe.com'],
        ['connect-src', 'https://m.stripe.network'],
        ['connect-src', 'https://r.stripe.com'],
        ['img-src', 'https://*.stripe.com'],
        ['img-src', 'https://*.cloudflarestream.com'],
    ])('both page policies allow %s %s', (name, host) => {
        expect(directive(allowlist!, name)).toContain(host);
        expect(directive(strict!, name)).toContain(host);
    });

    it('keeps the Maps hosts that were already there and adds no media-src', () => {
        expect(directive(allowlist!, 'script-src')).toContain('https://maps.googleapis.com');
        expect(directive(allowlist!, 'media-src')).toBeUndefined();
    });

    it('the API policy does not get them', () => {
        const api = buildCsp({ widgetEmbed: false });
        for (const host of ['stripe', 'cloudflarestream']) expect(api).not.toContain(host);
    });

    it('through pageSecurityHeaders, the strict policy is the allowlist policy minus unsafe-inline in script-src and style-src, and nothing else', () => {
        const withoutInline = allowlist!.replaceAll(" 'unsafe-inline'", '').replace('?p=a', '?p=b');
        expect(strict).toBe(withoutInline);
        expect(allowlist).not.toBe(strict);
        expect(directive(strict!, 'script-src')).not.toContain('unsafe-inline');
        expect(directive(strict!, 'style-src')).not.toContain('unsafe-inline');
    });
});

describe('strict policy sampling', () => {
    it('without the strict policy only the tagged allowlist policy is sent', () => {
        const h = headersFor('/login', '', false);
        expect(policies(h)).toHaveLength(1);
        expect(policies(h)[0]).toContain("'unsafe-inline'");
        expect(policies(h)[0]!.endsWith('report-uri /api/public/csp-report?p=a')).toBe(true);
        expect(h['Content-Security-Policy-Report-Only']).not.toContain('?p=b');
    });

    it('securityHeadersForPage asks the injected decision once per page and not at all for non-pages', () => {
        const url = new URL('https://x.test/login');
        const page = () => new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } });
        let asked = 0;
        const yes = () => { asked += 1; return true; };
        const no = () => { asked += 1; return false; };
        expect(securityHeadersForPage(page(), url, yes)['Content-Security-Policy-Report-Only']).toContain('?p=b');
        expect(securityHeadersForPage(page(), url, no)['Content-Security-Policy-Report-Only']).not.toContain('?p=b');
        expect(securityHeadersForPage(new Response('{}', { headers: { 'Content-Type': 'application/json' } }), url, yes)).toEqual({});
        expect(asked).toBe(2);
    });

    it('the default decision sends the strict policy on exactly one page in STRICT_POLICY_EVERY_NTH_PAGE', () => {
        const url = new URL('https://x.test/login');
        let strict = 0;
        for (let i = 0; i < STRICT_POLICY_EVERY_NTH_PAGE * 3; i += 1) {
            const res = new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } });
            if (securityHeadersForPage(res, url)['Content-Security-Policy-Report-Only']!.includes('?p=b')) strict += 1;
        }
        expect(strict).toBe(3);
    });
});

describe('securityHeadersForPage (what workers/app.ts stamps)', () => {
    const url = new URL('https://x.test/login');
    const html = () => new Response('<html></html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });

    it('stamps an HTML page', () => {
        expect(securityHeadersForPage(html(), url, () => true)['X-Frame-Options']).toBe('SAMEORIGIN');
    });

    it('stamps nothing on a redirect, an empty answer, JSON or a non-HTML response', () => {
        const redirect = new Response(null, { status: 302, headers: { Location: '/x', 'Content-Type': 'text/html' } });
        const notModified = new Response(null, { status: 304, headers: { 'Content-Type': 'text/html' } });
        const json = new Response('{}', { headers: { 'Content-Type': 'application/json' } });
        const plain = new Response('x', { headers: { 'Content-Type': 'text/plain' } });
        for (const res of [redirect, notModified, json, plain]) expect(securityHeadersForPage(res, url)).toEqual({});
    });

    it('lands on the finished page response through finishPage, and not on a redirect', () => {
        const request = new Request(url);
        const base = { request, startedAt: Date.now(), getRoutes: () => undefined };
        const page = finishPage({ ...base, res: html(), extraHeaders: securityHeadersForPage(html(), url) });
        expect(page.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
        expect(page.headers.get('Permissions-Policy')).toBe(PAGE_PERMISSIONS_POLICY);
        expect(page.headers.get('Content-Security-Policy-Report-Only')).toContain('report-uri /api/public/csp-report');
        expect(page.headers.get('Server-Timing')).toMatch(/^app;dur=\d+$/);

        const redirect = new Response(null, { status: 302, headers: { Location: '/x', 'Content-Type': 'text/html' } });
        const out = finishPage({ ...base, res: redirect, extraHeaders: securityHeadersForPage(redirect, url) });
        expect(out.headers.get('X-Frame-Options')).toBeNull();
    });

    it('is wired into the page-render branch of the worker entry and reads no body', () => {
        const src = readFileSync(new URL('../../../workers/app.ts', import.meta.url), 'utf8');
        expect(src).toMatch(/securityHeadersForPage\(rendered, new URL\(c\.req\.url\)\)/);
        expect(src).toMatch(/extraHeaders,\n/);
    });
});
