/**
 * The Content-Security-Policy allowlist, in one place.
 *
 * Both the API middleware (`middleware/security-headers.ts`, which ENFORCES it on
 * API responses) and the page headers (`page-security-headers.ts`, which reports
 * against it for HTML pages) build their policy here, so the two cannot drift.
 *
 * Imports nothing: `workers/app.ts` keeps a tiny top-level import graph, and the
 * page headers sit in it.
 */

/**
 * The widget embed pages: `/book?embed=1` (the legacy script widget) and
 * `/embed/*` (the company-level embed). They are the only responses that may be
 * framed by any origin; origin-allowlist enforcement on the booking submit
 * (POST /api/public/book) is the security boundary there, not frame-ancestors.
 */
export function isWidgetEmbedPath(path: string, embedQuery: string | null | undefined): boolean {
    return (path === '/book' && embedQuery === '1') || path.startsWith('/embed/');
}

/** Directives that accept extra hosts through `CspOptions.extraSources`. */
export type CspExtraDirective = 'script-src' | 'style-src' | 'connect-src' | 'img-src' | 'frame-src';

export interface CspOptions {
    /** Widget embed page: `frame-ancestors *` instead of `'none'`. */
    widgetEmbed: boolean;
    /** Keep `'unsafe-inline'` in script-src and style-src. Defaults to true. */
    allowInline?: boolean;
    /** Appended last as `report-uri`. Omit for no reporting. */
    reportUri?: string;
    /**
     * Hosts added to a directive on top of the shared allowlist. Absent means the enforced API
     * policy, byte for byte; the page policies use it for hosts only pages load.
     */
    extraSources?: Partial<Record<CspExtraDirective, readonly string[]>>;
}

/** Build the policy string. With default options the output is exactly the enforced API policy. */
export function buildCsp(options: CspOptions): string {
    const inline = options.allowInline !== false;
    const extra = (name: CspExtraDirective): string => {
        const hosts = options.extraSources?.[name] ?? [];
        return hosts.map((h) => ` ${h}`).join('');
    };
    return [
        "default-src 'self'",
        // maps.googleapis.com: the Google Maps JavaScript SDK (address
        // autocomplete map, Spec 5D B4) — a deliberate CDN exception to the
        // "no CDN except GA + Turnstile" rule; the SDK cannot be self-hosted.
        `script-src 'self'${inline ? " 'unsafe-inline'" : ''} https://challenges.cloudflare.com https://maps.googleapis.com${extra('script-src')}`,
        `style-src 'self'${inline ? " 'unsafe-inline'" : ''}${extra('style-src')}`,
        "font-src 'self' data:",
        // maps.gstatic.com / maps.googleapis.com: map tiles + marker sprites.
        `img-src 'self' data: blob: https://maps.gstatic.com https://maps.googleapis.com${extra('img-src')}`,
        // maps.googleapis.com: the Maps SDK's own XHR/fetch for tile metadata.
        `connect-src 'self' https://challenges.cloudflare.com https://maps.googleapis.com${extra('connect-src')}`,
        // 'self' required so the Settings → Embed Widget page can iframe
        // its own /book?embed=1 preview. Without it the live preview is blank.
        `frame-src 'self' https://challenges.cloudflare.com${extra('frame-src')}`,
        options.widgetEmbed ? 'frame-ancestors *' : "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
        ...(options.reportUri ? [`report-uri ${options.reportUri}`] : []),
    ].join('; ');
}
