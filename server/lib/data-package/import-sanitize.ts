/**
 * HTML sanitization for imported package rows.
 *
 * The importer accepts packages from untrusted sources. Any column that the
 * product renders as HTML must be passed through the SAME sanitizer the live
 * API uses on write, so a restored row cannot carry script/style/payloads that
 * a normal editor never could. Unknown fields and non-string values pass
 * through untouched (the row schema already checked their scalar type).
 */
import { sanitizeAgreementHtml } from '../../services/agreement/sanitizer';

/** DB columns whose values are rendered as rich text and must be sanitized. */
const HTML_COLUMNS: ReadonlySet<string> = new Set([
    'body', 'content', 'html', 'description', 'terms', 'notes_html',
]);

/** Sanitize the HTML-bearing columns of one row; never mutates the input. */
export function sanitizeImportedRow(
    row: Record<string, unknown>,
): { row: Record<string, unknown>; sanitized: string[] } {
    const out: Record<string, unknown> = {};
    const sanitized: string[] = [];
    for (const [key, value] of Object.entries(row)) {
        if (HTML_COLUMNS.has(key) && typeof value === 'string') {
            const clean = sanitizeAgreementHtml(value);
            out[key] = clean;
            if (clean !== value) sanitized.push(key);
        } else {
            out[key] = value;
        }
    }
    return { row: out, sanitized };
}
