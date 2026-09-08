/**
 * How the unread-field census decides that source text READS a property.
 *
 * Split out of `check-unread-fields.mjs` when that gate crossed the large-file
 * cap for the second time, on the seam its own history points at: everything
 * here answers one question — "does this text read `.foo`?" — and both of the
 * gate's most expensive bugs lived inside it. The gate keeps what it does with
 * the answer.
 */

/**
 * Prose is not a read.
 *
 * Caught by the gate turning on itself: its header names
 * `TemplateSchema.schemaVersion`, `ErasureRule.biometricStatus` and
 * `RetentionPolicyHeader.approvedBy` as EXAMPLES of what it hunts, and once the
 * file was tracked under `scripts/` it began counting its own documentation as
 * evidence that those fields are used. Seven findings disappeared for no reason
 * but that. A comment mentioning `.foo` HIDES a real finding, which is the
 * expensive direction to be wrong in.
 *
 * A comment is recognised only when it OPENS ITS OWN LINE, block or line alike.
 * The obvious regex form is worse than no stripping at all: a string literal
 * like `"/api/platform/*"` opens a block comment that runs to the next close,
 * and it ate 6108 of `workers/app.ts`'s 15732 characters — 39% of a file,
 * silently, taking a real `.hasPortalIntegrationApi` read with it and reporting
 * that field as unread. Deleting code from the corpus is the same error as
 * counting prose, in the same direction: it invents findings.
 */
export function withoutComments(src) {
    const out = [];
    let inBlock = false;
    for (const line of src.split('\n')) {
        const t = line.trimStart();
        if (inBlock) {
            if (line.includes('*/')) inBlock = false;
            out.push('');
            continue;
        }
        if (t.startsWith('/*')) {
            if (!line.includes('*/')) inBlock = true;
            out.push('');
            continue;
        }
        out.push(t.startsWith('//') ? '' : line);
    }
    return out.join('\n');
}

/**
 * Every shape that counts as READING a property. Anything missing from this
 * list becomes a false positive, so it is generous on purpose — a census that
 * cries wolf is one nobody reads.
 */
export function readsProperty(sources, prop) {
    const patterns = [
        new RegExp(`\\.${prop}\\b`),                                   // obj.prop
        new RegExp(`\\[\\s*["'\`]${prop}["'\`]\\s*\\]`),               // obj["prop"]
        new RegExp(`\\{[^{}]*\\b${prop}\\b[^{}]*\\}\\s*(?::|=[^=])`),  // destructuring
        new RegExp(`\\b${prop}\\s*=\\s*[{"'\`]`),                      // JSX prop={…} / prop="…"
        new RegExp(`\\b${prop}\\s*,`),                                 // shorthand in a destructure list
    ];
    for (const [, src] of sources) for (const re of patterns) if (re.test(src)) return true;
    return false;
}
