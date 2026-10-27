/**
 * The security headers `workers/app.ts` stamps on a rendered page, decided in one
 * place so it can be tested without the server build.
 *
 * Only what `finishPage` treats as a page gets them: an HTML document that is
 * not a redirect, a 204/304 or an empty answer. JSON, redirects and every other
 * content type get an empty set.
 *
 * Entry-graph rule (workers/app.ts): imports `page-timing.ts` (react-router and
 * the logger) and `page-security-headers.ts` (nothing), both already top-level.
 */
import { isPageResponse } from './page-timing';
import { pageSecurityHeaders, STRICT_POLICY_EVERY_NTH_PAGE } from './page-security-headers';

let pagesStamped = 0;

/** Per-isolate: true for every STRICT_POLICY_EVERY_NTH_PAGE-th page this isolate stamps. */
function everyNthPage(): boolean {
    pagesStamped += 1;
    return pagesStamped % STRICT_POLICY_EVERY_NTH_PAGE === 0;
}

/** `sendStrict` is injectable so a test can decide; the default samples one page in N per isolate. */
export function securityHeadersForPage(
    res: Response,
    url: URL,
    sendStrict: () => boolean = everyNthPage,
): Record<string, string> {
    return isPageResponse(res) ? pageSecurityHeaders(url.pathname, url.searchParams, sendStrict()) : {};
}
