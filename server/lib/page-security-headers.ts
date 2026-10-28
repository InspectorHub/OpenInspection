/**
 * Response headers for HTML pages.
 *
 * Pages are rendered by React Router in `workers/app.ts` and never pass through
 * the API app's `securityHeaders` middleware, so without this they would carry
 * no framing, referrer or feature policy at all.
 *
 * ENFORCED here: X-Frame-Options, Referrer-Policy, Permissions-Policy.
 * REPORT-ONLY here: Content-Security-Policy (two policies, see below). The page
 * CSP is not enforced yet: it reports to `/api/public/csp-report` so an operator can see
 * what pages load that the allowlist does not know about before switching it on.
 * `docs/operate/security-headers.md` describes the rollout.
 *
 * X-Frame-Options is SAMEORIGIN (and `frame-ancestors 'self'`): a page may be framed
 * by a page of the same origin, never by another site. The app itself frames no page
 * of its own except the widget embed pages, which are exempt below, so the policy
 * could be stricter; SAMEORIGIN is kept so that a same-origin frame still works for
 * checking a page at a narrow width. Who frames what today:
 *   - app/components/settings/EmbedWidgetPanel.tsx frames `/embed/<company>`
 *   - public/widget.js frames `/book?embed=1`
 *   - the other iframes are third-party (the Cloudflare Stream player in
 *     ReportMediaTile.tsx and VideoPlayer.tsx; Stripe.js, loaded by loadStripe in
 *     PayCard.tsx, BookingDepositPanel.tsx and StripePayPanel.tsx) or a sandboxed
 *     `srcDoc` email preview (EmailPreview.tsx). None frames a page of ours.
 *
 * Behaviour change to know about: report, portal and checkout pages previously
 * carried no framing protection and now send X-Frame-Options SAMEORIGIN, so a
 * third-party site that iframes one of them sees it blank. The booking embed
 * routes stay exempt. The API middleware keeps DENY: API responses are never framed.
 *
 * Permissions-Policy: the editor opens the camera with `getUserMedia({ video })`
 * (packages/field-ui/src/components/editor/BurstCamera.tsx), so camera is allowed
 * for this origin only. Nothing uses the microphone (no audio capture, no speech
 * recognition) or geolocation (address lookup goes through the server), so those
 * stay off. Features not listed keep the browser default; payment, fullscreen and
 * clipboard-write are left alone because Stripe Elements, the report video player
 * and the copy buttons rely on them. Turnstile's iframe needs no delegation.
 *
 * Entry-graph rule (workers/app.ts): imports only `csp-policy.ts`, which imports
 * nothing.
 */
import { buildCsp, isWidgetEmbedPath } from './csp-policy';

/** Where CSP violation reports are posted: same origin, relative, no credentials needed (the unauthenticated /api/public prefix). */
export const CSP_REPORT_PATH = '/api/public/csp-report';

/**
 * The strict policy (no 'unsafe-inline') is sent on one page in this many. It is
 * a measuring instrument: every inline script or style attribute on a page is one
 * violation, and the legacy `report-uri` posts once per violation, so sending it
 * on every page would turn each page view into dozens of requests. Counts taken
 * from policy `b` are therefore a sample: multiply by this number.
 */
export const STRICT_POLICY_EVERY_NTH_PAGE = 20;

/**
 * Hosts only pages load, added to both page policies and never to the API policy.
 *   - Stripe.js: `loadStripe` in PayCard.tsx:129, BookingDepositPanel.tsx:66 and
 *     StripePayPanel.tsx:58 loads the script from js.stripe.com and mounts Elements
 *     frames from the same host; hooks.stripe.com is the 3-D Secure frame. The
 *     api / m / r hosts are Stripe.js's own XHR and telemetry endpoints.
 * Google Maps and the Cloudflare Stream player (its iframe and thumbnails) are deliberately not repeated
 * here; they are in the shared allowlist. There is no media-src: the clip played in the page itself comes
 * from the worker's own origin.
 */
const PAGE_EXTRA_SOURCES = {
    'script-src': ['https://js.stripe.com'],
    'frame-src': ['https://js.stripe.com', 'https://hooks.stripe.com'],
    'connect-src': ['https://api.stripe.com', 'https://m.stripe.network', 'https://r.stripe.com'],
    'img-src': ['https://*.stripe.com'],
} as const;

export const PAGE_PERMISSIONS_POLICY = 'geolocation=(), microphone=(), camera=(self)';

/**
 * Headers for an HTML page response at `pathname` with query `query`.
 * Widget embed pages get no X-Frame-Options and `frame-ancestors *`.
 * `includeStrict` decides whether the strict report-only policy rides along; the
 * allowlist policy is always sent. The decision is the caller's, so this stays pure.
 */
export function pageSecurityHeaders(pathname: string, query: URLSearchParams, includeStrict: boolean): Record<string, string> {
    const embed = isWidgetEmbedPath(pathname, query.get('embed'));
    const headers: Record<string, string> = {
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': PAGE_PERMISSIONS_POLICY,
        // One header, up to two comma-separated policies; each is evaluated and
        // reported on its own, tagged `?p=a` / `?p=b` so the receiver can tell
        // them apart. `a` is the API allowlist. `b` drops 'unsafe-inline' from
        // script-src and style-src, so the report shows how much inline script
        // and style the pages use.
        'Content-Security-Policy-Report-Only': [
            buildCsp({ widgetEmbed: embed, sameOriginFraming: true, reportUri: `${CSP_REPORT_PATH}?p=a`, extraSources: PAGE_EXTRA_SOURCES }),
            ...(includeStrict ? [buildCsp({ widgetEmbed: embed, sameOriginFraming: true, allowInline: false, reportUri: `${CSP_REPORT_PATH}?p=b`, extraSources: PAGE_EXTRA_SOURCES })] : []),
        ].join(', '),
    };
    if (!embed) headers['X-Frame-Options'] = 'SAMEORIGIN';
    return headers;
}
