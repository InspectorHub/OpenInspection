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
