import { extractLocaleFromCookie, baseLocale, isLocale, type Locale } from "~/paraglide/runtime";

/**
 * The client's locale answer, which must agree with the server's.
 *
 * The server resolves `users.locale > tenant > cookie > Accept-Language > en`, so
 * a Spanish browser with NO cookie is served Spanish. A client resolver that reads
 * only the cookie answers `en` for that same request, and hydration silently
 * repaints the page in English — visible only if you look before hydration
 * finishes, which is why it presents as an intermittent test failure rather than
 * an obvious bug. The login page makes it reachable in practice: it sits outside
 * `auth-layout`, where the cookie stamp is written, so a first visit has no cookie
 * to read.
 *
 * `<html lang>` is the server's already-resolved answer, rendered into the very
 * document being hydrated. Reading it back is how the two agree without a second
 * resolution path that could disagree with the first.
 *
 * Extracted from `entry.client.tsx` so it can be tested: importing that module
 * hydrates the document as a side effect.
 */
export function resolveClientLocale(docLang: string): Locale {
    const fromCookie = extractLocaleFromCookie();
    if (fromCookie) return fromCookie;
    return isLocale(docLang) ? docLang : baseLocale;
}
