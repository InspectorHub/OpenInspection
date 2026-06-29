/**
 * Validates that a redirect target is a same-origin path before honoring it.
 *
 * Accepts only paths that start with a single '/' (not '//') and contain no
 * backslashes. This blocks protocol-relative URLs (//evil.test), absolute
 * URLs (https://...), scheme-based payloads (javascript:...), and the
 * /\evil trick that some browsers resolve as //evil.
 *
 * @param raw      The raw `return_to` value from the query string (may be null/undefined).
 * @param fallback The default redirect path to use when `raw` fails validation.
 * @returns        `raw` if it passes same-origin validation, else `fallback`.
 */
export function safeReturnTo(raw: string | null | undefined, fallback: string): string {
    if (!raw) return fallback;
    // Must be a path starting with '/', ruling out absolute URLs and bare strings.
    if (!raw.startsWith('/')) return fallback;
    // Reject protocol-relative URLs (//evil.test).
    if (raw.startsWith('//')) return fallback;
    // Reject backslashes — browsers treat /\evil as //evil (open redirect).
    if (raw.includes('\\')) return fallback;
    return raw;
}
