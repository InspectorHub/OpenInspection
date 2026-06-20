/**
 * Sanitize HTML output from Quill editor.
 * Allow-list matches the editor's toolbar: bold/italic/underline, h2/h3, lists, indent classes.
 * Strips all other tags, all attributes except `class` (for ql-indent-N), and any script/style/iframe content entirely.
 */
export function sanitizeAgreementHtml(html: string): string {
    if (!html) return '';
    // Plain text? No HTML detected — return as-is, render-time wraps it
    if (!html.includes('<')) return html;

    let out = html;

    // Remove dangerous element pairs and their content (script, style, iframe, object, embed, form, etc.)
    const dangerousElements = ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'svg', 'math', 'link', 'meta'];
    for (const tag of dangerousElements) {
        const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>|<${tag}\\b[^>]*\\/?>`, 'gi');
        out = out.replace(re, '');
    }

    // Remove HTML comments (could hide payload like <!--><script>...)
    // CodeQL js/incomplete-multi-character-sanitization — single pass can leave reconstructed
    // <!-- after a partial removal. Loop until stable.
    {
        let prev;
        do { prev = out; out = out.replace(/<!--[\s\S]*?-->/g, ''); } while (out !== prev);
    }

    // Allow-listed tags. Anything else gets stripped (tags only, content preserved).
    const allowed = new Set(['p', 'strong', 'em', 'u', 'b', 'i', 'h2', 'h3', 'ol', 'ul', 'li', 'br', 'span']);

    // Match any tag (opening, closing, self-closing). For each match, decide: keep, strip-tag, or transform.
    out = out.replace(/<\/?([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g, (_match, tag: string, attrs: string) => {
        const tagLower = tag.toLowerCase();
        if (!allowed.has(tagLower)) return '';
        // Determine if it's a closing tag
        const isClosing = _match.startsWith('</');
        if (isClosing) return `</${tagLower}>`;

        // Allow `class` attribute only for ol/ul (Quill uses ql-indent-N for indent)
        if ((tagLower === 'ol' || tagLower === 'ul' || tagLower === 'li' || tagLower === 'p') && attrs) {
            const classMatch = attrs.match(/\bclass="(ql-[a-z0-9-]+(?:\s+ql-[a-z0-9-]+)*)"/i);
            if (classMatch) return `<${tagLower} class="${classMatch[1]}">`;
        }
        // Self-closing for br
        if (tagLower === 'br') return '<br>';
        return `<${tagLower}>`;
    });

    // Strip any remaining `javascript:`, `data:`, or event-handler attribute leftovers (defense in depth)
    // CodeQL js/incomplete-multi-character-sanitization — broaden boundary from \s+ to
    // (?:\s|^|>) so on* attributes flush against tag opening (e.g., `<a"on click=x>`)
    // are also caught. Then loop until stable for chained removals.
    {
        let prev;
        do {
            prev = out;
            out = out
                .replace(/(?:\s|^|>)on\w+\s*=\s*"[^"]*"/gi, m => m.startsWith('>') ? '>' : '')
                .replace(/(?:\s|^|>)on\w+\s*=\s*'[^']*'/gi, m => m.startsWith('>') ? '>' : '');
        } while (out !== prev);
    }

    return out;
}
