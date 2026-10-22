/**
 * The `<expr>.execute(` call shape: the field-ui command channel (FieldDataSource.execute). Every command is a
 * write, so a call site is a raw write exactly like a raw `fetcher.submit(`. app/ has no `.execute(` today, which
 * is why the shape is not scoped by path. The only escape is a `busy-controls-allow: <reason>` comment on the
 * call's line or up to three lines above it (the reason must contain a word).
 *
 * Shapes recognised (all on comment-blanked text):
 *   - `ds.execute(`, `ds?.execute(`, `ds!.execute(`, `f().execute(`, `list[0].execute(`, with whitespace or a line
 *     break around the dot and before the parenthesis;
 *   - a destructured `execute`: once a file contains `{ ..., execute, ... } = ...`, a bare `execute(` call in it
 *     is the same call (this is the form a component gets from a hook that returns the data source);
 *   - an alias or indirect use: `.execute` NOT followed by a call (`const run = ds.execute`, `ds.execute.call(`),
 *     which would hide the call from the shape above.
 * A method or function that is merely named `execute` (`async execute(id) {`) is none of these and stays clean.
 *
 * Used by scripts/check-submit-guard.mjs and scripts/lib/busy-controls-detect.mjs.
 */
const MEMBER_CALL = /([A-Za-z_$][\w$]*|[)\]])[!?]*\s*(?:\?\.|\.)\s*execute\s*\??\.?\s*\(/g;
const MEMBER_REFERENCE = /(?:[A-Za-z_$][\w$]*|[)\]])[!?]*\s*(?:\?\.|\.)\s*execute\b(?!\s*\??\.?\s*\()/g;
const DESTRUCTURED = /\{[^{}]*\bexecute\b[^{}]*\}\s*=(?!=)/;
const BARE_CALL = /(?<![.\w$])execute\s*\(/g;
const EXECUTE_ALLOW = /(?:\/\/|\/\*)\s*busy-controls-allow:\s*\S*\w/;

const newlinesBefore = (text, at) => (text.slice(0, at).match(/\n/g) ?? []).length;

/**
 * Offsets (and the text to show) of every `.execute` use in `text`, before any marker is applied.
 * @param {string} text source with comments (and optionally strings) blanked, offsets preserved
 * @returns {{ index: number, label: string }[]}
 */
export function executeCallIndices(text) {
    const out = [];
    for (const m of text.matchAll(MEMBER_CALL)) out.push({ index: m.index, label: `${m[1]}.execute(` });
    for (const m of text.matchAll(MEMBER_REFERENCE)) out.push({ index: m.index, label: 'a reference to .execute' });
    if (DESTRUCTURED.test(text)) {
        for (const m of text.matchAll(BARE_CALL)) {
            // `async execute(id) {` / `function execute(` declare it; they are not calls.
            if (/(?:async\s+|function\s+|get\s+|set\s+)$/.test(text.slice(Math.max(0, m.index - 12), m.index))) continue;
            out.push({ index: m.index, label: 'execute(' });
        }
    }
    return out.sort((x, y) => x.index - y.index);
}

/**
 * Offsets of every unexcused `.execute` use in `stripped` (comments blanked, offsets preserved).
 * @param {string} stripped source with comments blanked
 * @param {string[]} lines the original source lines, comments intact (the marker lives in a comment)
 * @returns {number[]}
 */
export function executeCallSites(stripped, lines) {
    const out = [];
    for (const { index } of executeCallIndices(stripped)) {
        const at = newlinesBefore(stripped, index);
        if (lines.slice(Math.max(0, at - 3), at + 1).some((l) => EXECUTE_ALLOW.test(l))) continue;
        out.push(index);
    }
    return out;
}
