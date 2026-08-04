import { describe, it, expect } from 'vitest';
import {
    readUiLocaleCookie,
    resolveUiLocale,
    setUiLocaleInCookieHeader,
    uiLocaleSetCookie,
    uiLocaleStampFor,
    withResolvedUiLocale,
} from '../../../server/lib/i18n/ui-locale';

/**
 * Every fixture starts from ALL FOUR sources present and ADVERSE — each test
 * then names the one rung it is about. A chain test seeded with only the value
 * it expects back passes against a hardcoded return, which is how a resolver
 * ships answering one thing forever.
 */
const ADVERSE = {
    userLocale: 'fr-FR',
    tenantDefault: 'fr-FR',
    cookie: 'fr-FR',
    acceptLanguage: 'fr-FR,fr;q=0.9',
};

describe('resolveUiLocale precedence', () => {
    it('prefers the viewer’s own stored choice above everything', () => {
        expect(resolveUiLocale({
            userLocale: 'es-419',
            tenantDefault: 'en-US',
            cookie: 'en',
            acceptLanguage: 'en-GB,en;q=0.9',
        })).toBe('es-419');
        // ...and the other way round, so a test that only ever expects Spanish
        // cannot pass on a resolver that only ever answers Spanish.
        expect(resolveUiLocale({
            userLocale: 'en-US',
            tenantDefault: 'es-419',
            cookie: 'es-419',
            acceptLanguage: 'es-419,es;q=0.9',
        })).toBe('en');
    });

    it('falls to the tenant default when the viewer has none', () => {
        expect(resolveUiLocale({
            ...ADVERSE, userLocale: null, tenantDefault: 'es-MX',
        })).toBe('es-419');
        expect(resolveUiLocale({
            ...ADVERSE, userLocale: null, tenantDefault: 'en-US', cookie: 'es-419',
        })).toBe('en');
    });

    it('lets the cookie beat the browser, because it is the explicit choice', () => {
        // The switcher's whole contract. A Spanish-browsered viewer who picks
        // English must KEEP English on the next page load; ranking the browser
        // above the cookie hands it straight back and reads as a dead control.
        expect(resolveUiLocale({
            userLocale: null, tenantDefault: null,
            cookie: 'en', acceptLanguage: 'es-419,es;q=0.9,en;q=0.5',
        })).toBe('en');
        expect(resolveUiLocale({
            userLocale: null, tenantDefault: null,
            cookie: 'es-419', acceptLanguage: 'en-US,en;q=0.9',
        })).toBe('es-419');
    });

    it('falls to Accept-Language when no preference of any kind is stored', () => {
        expect(resolveUiLocale({
            userLocale: null, tenantDefault: null, cookie: null,
            acceptLanguage: 'es-419,es;q=0.9,en;q=0.5',
        })).toBe('es-419');
        // Weighted, not first-listed: 'fr' outranks nothing we speak, so the
        // scan must continue to the Spanish entry rather than stop.
        expect(resolveUiLocale({
            userLocale: null, tenantDefault: null, cookie: null,
            acceptLanguage: 'fr-FR,es-MX;q=0.8,en;q=0.3',
        })).toBe('es-419');
    });

    it('ends at English, never at undefined', () => {
        expect(resolveUiLocale(ADVERSE)).toBe('en');
        expect(resolveUiLocale({})).toBe('en');
    });

    it('ignores an unsupported value instead of stopping the chain on it', () => {
        // A viewer whose stored locale names a language we dropped must still
        // get their tenant's language, not a silent drop to English.
        expect(resolveUiLocale({
            ...ADVERSE, userLocale: 'de-DE', tenantDefault: 'es-419',
        })).toBe('es-419');
        // Same for junk that makes `new Intl.Locale` throw.
        expect(resolveUiLocale({
            ...ADVERSE, userLocale: 'not a locale!!', tenantDefault: 'es-419',
        })).toBe('es-419');
    });
});

describe('readUiLocaleCookie', () => {
    it('finds the value among the other cookies a real request carries', () => {
        expect(readUiLocaleCookie('__Host-inspector_token=abc.def; PARAGLIDE_LOCALE=es-419; oi-color-scheme=dark'))
            .toBe('es-419');
    });

    it('returns null when absent, empty, or only a name that ENDS with ours', () => {
        expect(readUiLocaleCookie('__Host-inspector_token=abc')).toBeNull();
        expect(readUiLocaleCookie('')).toBeNull();
        expect(readUiLocaleCookie(null)).toBeNull();
        // A substring match here would read someone else's cookie as the locale.
        expect(readUiLocaleCookie('XPARAGLIDE_LOCALE=es-419')).toBeNull();
        expect(readUiLocaleCookie('PARAGLIDE_LOCALE=')).toBeNull();
    });

    it('does NOT normalise — a stale tag must read back as itself', () => {
        // The caller compares this against a resolved locale to decide whether
        // to rewrite. Normalising here would report 'en-US' as already correct
        // and the cookie would never be replaced.
        expect(readUiLocaleCookie('PARAGLIDE_LOCALE=en-US')).toBe('en-US');
    });
});

describe('setUiLocaleInCookieHeader', () => {
    it('keeps every other cookie — the JWT rides in this header', () => {
        const out = setUiLocaleInCookieHeader('__Host-inspector_token=abc.def; oi-color-scheme=dark', 'es-419');
        expect(out).toContain('__Host-inspector_token=abc.def');
        expect(out).toContain('oi-color-scheme=dark');
        expect(out).toContain('PARAGLIDE_LOCALE=es-419');
    });

    it('replaces an existing value rather than appending a second one', () => {
        const out = setUiLocaleInCookieHeader('PARAGLIDE_LOCALE=en; a=1', 'es-419');
        expect(out.match(/PARAGLIDE_LOCALE=/g)).toHaveLength(1);
        expect(readUiLocaleCookie(out)).toBe('es-419');
    });

    it('handles a request that carried no cookies at all', () => {
        expect(setUiLocaleInCookieHeader(null, 'es-419')).toBe('PARAGLIDE_LOCALE=es-419');
    });
});

describe('withResolvedUiLocale (the seam)', () => {
    const req = (headers: Record<string, string>) =>
        new Request('https://example.test/login', { headers });

    it('stamps the browser’s language onto a first visit that has no cookie', () => {
        const out = withResolvedUiLocale(req({ 'Accept-Language': 'es-419,es;q=0.9' }));
        expect(readUiLocaleCookie(out.headers.get('Cookie'))).toBe('es-419');
    });

    it('leaves the request untouched once the cookie already agrees', () => {
        const original = req({ Cookie: 'PARAGLIDE_LOCALE=es-419', 'Accept-Language': 'en-US' });
        // Identity, not equality: the steady state must not allocate a Request
        // per page load, and must not risk dropping anything a copy would.
        expect(withResolvedUiLocale(original)).toBe(original);
    });

    it('rewrites a stale tag the cookie contract cannot serve', () => {
        // 'en-US' is what the settings picker stores; Paraglide has no such
        // locale, so an unrewritten cookie falls back to baseLocale by accident
        // rather than by decision.
        const out = withResolvedUiLocale(req({ Cookie: 'PARAGLIDE_LOCALE=en-US' }));
        expect(readUiLocaleCookie(out.headers.get('Cookie'))).toBe('en');
    });

    it('preserves the session cookie while rewriting the locale one', () => {
        const out = withResolvedUiLocale(req({
            Cookie: '__Host-inspector_token=abc.def',
            'Accept-Language': 'es-MX',
        }));
        expect(out.headers.get('Cookie')).toContain('__Host-inspector_token=abc.def');
        expect(readUiLocaleCookie(out.headers.get('Cookie'))).toBe('es-419');
    });

    it('preserves the method and URL it was handed', () => {
        const post = new Request('https://example.test/inspections', {
            method: 'POST', body: 'x', headers: { 'Accept-Language': 'es-419' },
        });
        const out = withResolvedUiLocale(post);
        expect(out.method).toBe('POST');
        expect(out.url).toBe('https://example.test/inspections');
    });
});

describe('uiLocaleStampFor (the database half)', () => {
    const req = (headers: Record<string, string>) =>
        new Request('https://example.test/inspections', { headers });
    const NO_PREFERENCE = { userLocale: null, tenantDefault: null };

    it('corrects a cookie that disagrees with the stored preference', () => {
        // The whole point of #269: a viewer who set Spanish in Settings before
        // this shipped must get Spanish without touching the new switcher.
        const stamp = uiLocaleStampFor(
            req({ Cookie: 'PARAGLIDE_LOCALE=en', 'Accept-Language': 'en-US' }),
            { userLocale: 'es-419', tenantDefault: 'en-US' },
        );
        expect(stamp).not.toBeNull();
        expect(readUiLocaleCookie(stamp!.split(';')[0])).toBe('es-419');
    });

    it('stamps nothing once the cookie already agrees — the common case', () => {
        expect(uiLocaleStampFor(
            req({ Cookie: 'PARAGLIDE_LOCALE=es-419' }),
            { userLocale: 'es-419', tenantDefault: 'en-US' },
        )).toBeNull();
    });

    it('cannot oscillate: what it writes is what the seam then resolves', () => {
        // Feed the stamp's own output back through the request-borne resolver
        // and then through the stamp again. A second stamp here would mean the
        // two halves disagree and every page load would rewrite the cookie.
        const stored = { userLocale: null, tenantDefault: 'en-US' };
        const first = uiLocaleStampFor(
            req({ 'Accept-Language': 'es-419,es;q=0.9' }), stored,
        );
        expect(first).not.toBeNull();
        const settled = req({
            Cookie: first!.split(';')[0],
            'Accept-Language': 'es-419,es;q=0.9',
        });
        expect(uiLocaleStampFor(settled, stored)).toBeNull();
        expect(withResolvedUiLocale(settled)).toBe(settled);
    });

    it('corrects the stale tag the settings picker actually writes', () => {
        // users.locale is 'en-US'/'es-419' (app/lib/locales.ts LOCALE_OPTIONS),
        // never 'en'. Stamping it verbatim would put a tag in the cookie that
        // Paraglide has no locale for.
        const stamp = uiLocaleStampFor(req({}), { userLocale: 'en-US', tenantDefault: null });
        expect(readUiLocaleCookie(stamp!.split(';')[0])).toBe('en');
    });

    it('falls to the browser when nothing at all is stored', () => {
        const stamp = uiLocaleStampFor(
            req({ 'Accept-Language': 'es-MX,es;q=0.9' }), NO_PREFERENCE,
        );
        expect(readUiLocaleCookie(stamp!.split(';')[0])).toBe('es-419');
    });
});

describe('uiLocaleSetCookie', () => {
    it('round-trips through the reader and lasts beyond the session', () => {
        const value = uiLocaleSetCookie('es-419');
        expect(readUiLocaleCookie(value.split(';')[0])).toBe('es-419');
        expect(value).toContain('Path=/');
        expect(value).toContain('Max-Age=31536000');
        // Readable by the client switcher, which writes the same cookie.
        expect(value).not.toContain('HttpOnly');
    });
});
