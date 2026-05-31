/**
 * Minimal Mustache-style `{{var}}` substitution.
 *
 * Used to render structured defect fields (location, trade, deadline,
 * timeframe) and item attributes (brand, year, model) into canned-comment
 * prose. Intentionally tiny — no helpers, no partials, no escaping,
 * no recursion. Unresolved (missing / null / undefined) variables stay as
 * their literal `{{key}}` token so the publish-readiness gate can detect
 * them via {@link listUnresolved}.
 *
 * Mirrored verbatim at `app/lib/mustache.ts` so the live preview
 * and PDF pipeline produce identical output.
 */

const TOKEN_RE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_-]*)\s*\}\}/g;

export function renderTemplate(
    text: string,
    vars: Record<string, string | null | undefined>,
): string {
    return text.replace(TOKEN_RE, (literal, key: string) => {
        const v = vars[key];
        if (v === null || v === undefined) return literal;
        return v;
    });
}

/**
 * Returns the set of token keys in `text` that have no resolved value in
 * `vars` (null / undefined / missing). Empty strings ARE considered
 * resolved — that lets a comment opt into rendering with a blank value
 * (e.g. an inspector intentionally omits the optional brand).
 */
export function listUnresolved(
    text: string,
    vars: Record<string, string | null | undefined>,
): string[] {
    const seen = new Set<string>();
    let match: RegExpExecArray | null;
    TOKEN_RE.lastIndex = 0;
    while ((match = TOKEN_RE.exec(text)) !== null) {
        const key = match[1];
        if (key && (vars[key] === null || vars[key] === undefined)) {
            seen.add(key);
        }
    }
    return Array.from(seen);
}
