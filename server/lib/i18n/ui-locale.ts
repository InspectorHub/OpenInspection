/**
 * Which language to render the UI in, for THIS request.
 *
 * Sibling to `contact-locale.ts`, and deliberately a separate chain. That one
 * answers "what language is this PERSON addressed in" for a notification that
 * may be composed from cron with no request at all. This one answers "what
 * language does this PAGE render in", where a request always exists and the
 * viewer is the reader. The two share the tag reduction and the Accept-Language
 * ranking — a product that renders Spanish and then emails English is one bug,
 * not two — but their precedence differs, because only this one has a cookie.
 *
 * PRECEDENCE, highest first:
 *   1. `userLocale`     — `users.locale`, the viewer's own stated choice.
 *   2. `tenantDefault`  — `tenant_configs.default_locale`, the company's choice.
 *   3. `cookie`         — `PARAGLIDE_LOCALE`, what the switcher last stamped.
 *   4. `acceptLanguage` — the browser hint. Weakest: it describes a device.
 *   5. `'en'`           — the base locale.
 *
 * WHY THE COOKIE SITS AT 3 AND NOT AT 5. It is below the stored preferences
 * because it caches a past decision on ONE device, and a preference changed on
 * another device must beat it. It is above `Accept-Language` because it is the
 * only record of an EXPLICIT choice available on a request that has not reached
 * the database yet: put it below, and a Spanish-browsered user who deliberately
 * picks English gets Spanish back on the very next page load, with the switcher
 * apparently ignoring them. (The plan for #269 originally ordered it below
 * Accept-Language; that ordering makes the switcher non-functional for exactly
 * the users who need it, and was corrected here with a test.)
 *
 * Each rung FALLS THROUGH on an absent or unsupported value rather than
 * stopping on it — see `normalizeLocale`, which returns null rather than a
 * default precisely so this chain can keep walking.
 */
import {
    DEFAULT_CONTACT_LOCALE,
    localeFromAcceptLanguage,
    normalizeLocale,
    type ContactLocale,
} from './contact-locale';

/**
 * The cookie Paraglide's `cookie` strategy reads (`project.inlang/settings.json`
 * / the compiled runtime's `cookieName`). Named here so the writer (the
 * switcher), the reader (this module) and the seam below cannot drift apart.
 */
export const UI_LOCALE_COOKIE = 'PARAGLIDE_LOCALE';

/** Everything a request can tell us about the viewer's language. Every field is
 *  optional because every field is genuinely often absent — a pre-auth page has
 *  no user and no tenant, and a first visit has no cookie. */
export interface UiLocaleSources {
    /** `users.locale` — the viewer's per-user override, or null to inherit. */
    userLocale?: string | null;
    /** `tenant_configs.default_locale` — the company's configured locale. */
    tenantDefault?: string | null;
    /** The `PARAGLIDE_LOCALE` cookie value, if the request carries one. */
    cookie?: string | null;
    /** The request's `Accept-Language` header. */
    acceptLanguage?: string | null;
}

/** Resolve the language this request's UI renders in. See the precedence at the
 *  top of this file; it is documented there once and nowhere else. */
export function resolveUiLocale(sources: UiLocaleSources): ContactLocale {
    return normalizeLocale(sources.userLocale)
        ?? normalizeLocale(sources.tenantDefault)
        ?? normalizeLocale(sources.cookie)
        ?? localeFromAcceptLanguage(sources.acceptLanguage)
        ?? DEFAULT_CONTACT_LOCALE;
}

/**
 * The raw `PARAGLIDE_LOCALE` value out of a `Cookie` header, unnormalised.
 *
 * Unnormalised on purpose: callers compare it against a resolved locale to
 * decide whether to REWRITE the cookie, and a normalising read would report a
 * stale `en-US` cookie as already correct and never replace it.
 */
export function readUiLocaleCookie(cookieHeader: string | null | undefined): string | null {
    if (!cookieHeader) return null;
    for (const part of cookieHeader.split(';')) {
        const eq = part.indexOf('=');
        if (eq < 0) continue;
        if (part.slice(0, eq).trim() !== UI_LOCALE_COOKIE) continue;
        return decodeURIComponent(part.slice(eq + 1).trim()) || null;
    }
    return null;
}

/** A `Cookie` header with `PARAGLIDE_LOCALE` set to `locale`, every other
 *  cookie preserved in order. The JWT rides in this header too, so dropping the
 *  rest would log the viewer out to change their language. */
export function setUiLocaleInCookieHeader(
    cookieHeader: string | null | undefined,
    locale: ContactLocale,
): string {
    const pair = `${UI_LOCALE_COOKIE}=${locale}`;
    if (!cookieHeader) return pair;
    const kept = cookieHeader
        .split(';')
        .map((p) => p.trim())
        .filter((p) => p !== '' && p.split('=')[0].trim() !== UI_LOCALE_COOKIE);
    return [...kept, pair].join('; ');
}

/**
 * THE SEAM. Paraglide reads the locale off the INCOMING request, so a locale
 * decided after the request is handed over cannot affect the render that is
 * already happening — a first visit would render English and only obey the
 * visitor on their second page load. This rewrites the incoming `Cookie` header
 * before `paraglideMiddleware` ever sees the request, so the very first render
 * is already in the right language.
 *
 * Seam A of the two the plan weighed, and chosen over `overwriteGetLocale` on
 * the server: this depends only on the cookie contract already configured
 * (`strategy: ["cookie", "baseLocale"]`), while an override installs a resolver
 * whose behaviour under concurrent multi-tenant SSR would have to be proven —
 * the same hazard that keeps the `globalVariable` strategy excluded.
 *
 * ONLY request-borne sources are read here. `users.locale` and the tenant
 * default live in D1, and reading them would mean authenticating and querying
 * on every page load, ahead of the router, for a value that changes about once
 * per user per career. Those two rungs reach this function the way every other
 * device-level preference in this app does: stamped into the cookie by the
 * surface that knows them (`auth-layout`'s loader, and the switcher).
 *
 * Returns the ORIGINAL request untouched when the cookie already says the right
 * thing.
 *
 * It does NOT persist what it resolved, and that is deliberate rather than an
 * omission. Nothing pre-auth constitutes an explicit choice — the switcher
 * lives in the authenticated sidebar — so an anonymous visitor's language is
 * re-read from `Accept-Language` on every request, which is both stateless and
 * correct: change the browser's language and the next page follows, with no
 * stale cookie to fight. Persistence begins where a CHOICE begins, at
 * `uiLocaleStampFor` (a stored preference) and the switcher (a click).
 *
 * One consequence to keep in mind when reading `uiLocaleStampFor`: by the time
 * a loader runs, the header this rewrote is what it sees, so the "cookie" rung
 * downstream is the locale ALREADY IN EFFECT, not necessarily one the browser
 * ever stored. That is what makes the stamp fire only when a stored preference
 * genuinely disagrees with the rendered page.
 */
export function withResolvedUiLocale(request: Request): Request {
    const cookieHeader = request.headers.get('Cookie');
    const cookie = readUiLocaleCookie(cookieHeader);
    const locale = resolveUiLocale({
        cookie,
        acceptLanguage: request.headers.get('Accept-Language'),
    });
    if (cookie === locale) return request;
    const headers = new Headers(request.headers);
    headers.set('Cookie', setUiLocaleInCookieHeader(cookieHeader, locale));
    return new Request(request, { headers });
}

/** A `Set-Cookie` value that stamps the resolved locale for a year. Not
 *  `HttpOnly`: the switcher writes the same cookie from the client, and a
 *  display preference is not a credential. `SameSite=Lax` matches the other
 *  UI-preference cookies (`oi-color-scheme`, `oi-sidebar-collapsed`). */
export function uiLocaleSetCookie(locale: ContactLocale): string {
    return `${UI_LOCALE_COOKIE}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

/**
 * The OTHER half of the seam: the two rungs that live in D1.
 *
 * `withResolvedUiLocale` runs ahead of the router and cannot see `users.locale`
 * or `tenant_configs.default_locale`. This decides, given a request and the
 * stored preferences an authenticated loader already holds, whether the cookie
 * needs correcting — returning the `Set-Cookie` value, or `null` when it is
 * already right.
 *
 * Returning null in the common case is what makes this safe to call on every
 * authenticated page load, and is also what makes it impossible to oscillate:
 * the value written is the value `withResolvedUiLocale` will resolve once the
 * cookie carries it, so the next request finds them equal and stamps nothing.
 */
export function uiLocaleStampFor(
    request: Request,
    stored: Pick<UiLocaleSources, 'userLocale' | 'tenantDefault'>,
): string | null {
    const cookie = readUiLocaleCookie(request.headers.get('Cookie'));
    const desired = resolveUiLocale({
        // `?? null` rather than a spread: `exactOptionalPropertyTypes` makes an
        // explicitly-passed `undefined` a different thing from an absent key.
        userLocale: stored.userLocale ?? null,
        tenantDefault: stored.tenantDefault ?? null,
        cookie,
        acceptLanguage: request.headers.get('Accept-Language'),
    });
    return cookie === desired ? null : uiLocaleSetCookie(desired);
}
