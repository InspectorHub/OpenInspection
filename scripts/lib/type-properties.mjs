/**
 * Every property declared on an object type, with where it was declared.
 *
 * Extracted from `check-unread-fields.mjs` so that gate stays under the size
 * cap, and because "list the declared properties of these sources" is a
 * question worth answering on its own.
 */

/**
 * The body of an object type, found by matching braces from the declaration's
 * opening `{`.
 *
 * The obvious line-based approximation — start at the declaration, add braces,
 * subtract braces — walks straight off the end of the type and into the file,
 * and then reports every function PARAMETER below it as a property of that
 * type. Measured while writing this: it invented ten fields on two types in
 * `app/lib/editor/structure-ops.ts`, all of them parameters of the functions
 * that happened to follow.
 */
function bodySpan(src, openBraceIdx) {
    let depth = 0;
    for (let i = openBraceIdx; i < src.length; i++) {
        const ch = src[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return [openBraceIdx + 1, i];
        }
    }
    return null;
}

const DECL = /(?:export\s+)?(?:interface\s+(\w+)\s*(?:extends\s+[^{]+)?|type\s+(\w+)\s*=\s*)\{/g;
/** `name?: …` / `readonly name: …` at the top level of a type body. */
const PROP = /^[ \t]*(?:readonly\s+)?(\w+)\??\s*:/;

export function declaredProperties(sources) {
    const declared = [];
    for (const [file, src] of sources) {
    for (const m of src.matchAll(DECL)) {
        const open = m.index + m[0].length - 1;
        const span = bodySpan(src, open);
        if (!span) continue;
        const typeName = m[1] ?? m[2];
        const body = src.slice(span[0], span[1]);
        const firstLine = src.slice(0, span[0]).split('\n').length;

        let depth = 0;
        body.split('\n').forEach((line, i) => {
            const atTop = depth === 0;
            depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
            if (!atTop) return;
            const trimmed = line.trim();
            if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('[')) return;
            const p = line.match(PROP);
            if (p) declared.push({ file, type: typeName, prop: p[1], line: firstLine + i });
        });
    }
}
    return declared;
}
